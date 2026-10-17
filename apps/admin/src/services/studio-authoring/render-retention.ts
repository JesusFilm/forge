import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "../errors"
import {
  studioAssetReferenceSchema,
  studioAttemptResultSchema,
  studioDigestSchema,
  studioDocumentSchema,
  studioIdSchema,
  type StudioAssetReference,
} from "@forge/studio-contracts"
import {
  STUDIO_RENDER_OUTPUT_MAX_PARTS,
  STUDIO_RENDER_OUTPUT_PART_BYTES,
  STUDIO_RENDER_PROFILE,
  studioCodecProofSchema,
  studioRenderExecutionProfileSchema,
  studioRenderOutputPartSchema,
} from "@forge/studio-contracts/render"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import {
  StudioAssetService,
  byteDigest,
  readVerifiedStudioAsset,
} from "./assets"
import { StudioCommandError } from "./errors"
import { studioActor, studioHash } from "./state"

const retentionSchema = z
  .object({
    attemptId: studioIdSchema,
    leaseId: z.uuid(),
    parts: z
      .array(studioAssetReferenceSchema)
      .min(1)
      .max(STUDIO_RENDER_OUTPUT_MAX_PARTS),
    proof: studioCodecProofSchema,
  })
  .strict()
const snapshotSchema = z
  .object({
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    inputHash: studioDigestSchema,
    document: studioDocumentSchema,
    executionProfile: studioRenderExecutionProfileSchema,
  })
  .strict()

const ASSEMBLY_SLOT = Symbol.for("forge.studio-render-output-assembly")
function assemblySlot() {
  const shared = globalThis as typeof globalThis & {
    [ASSEMBLY_SLOT]?: { active: boolean }
  }
  return (shared[ASSEMBLY_SLOT] ??= { active: false })
}

/** Server-only storage assembly. Issued losing/late leases may retain artifacts;
 * only StudioRenderJobs.finish decides whether their result is admitted. */
export class StudioRenderRetention {
  constructor(private readonly db: PrismaClient) {}

  async retain(user: Principal | null, raw: unknown, signal?: AbortSignal) {
    const actor = studioActor(user)
    if (actor.kind !== "service" || actor.id !== "manager_backend")
      throw new ForbiddenError("Trusted render worker required")
    const input = retentionSchema.parse(raw)
    signal?.throwIfAborted()
    const slot = assemblySlot()
    if (slot.active) throw new StudioCommandError("PROJECT_BUSY")
    slot.active = true
    try {
      return await this.retainIssued(user, input, signal)
    } finally {
      // Await the actual storage/registration operation, never a response-timeout race.
      slot.active = false
    }
  }

  private async retainIssued(
    user: Principal | null,
    input: z.infer<typeof retentionSchema>,
    signal?: AbortSignal,
  ) {
    const issued = await this.db.shortRenderLease.findUnique({
      where: {
        attemptId_leaseId: {
          attemptId: input.attemptId,
          leaseId: input.leaseId,
        },
      },
    })
    const job = await this.db.shortRenderJob.findUnique({
      where: { attemptId: input.attemptId },
      include: { attempt: true },
    })
    if (!issued || !job || job.attempt.kind !== "RENDER")
      throw new StudioCommandError("INVALID")
    const snapshot = snapshotSchema.parse(job.snapshot)
    const { document } = snapshot
    const { proof } = input
    if (
      snapshot.executionProfile.id !== STUDIO_RENDER_PROFILE.id ||
      snapshot.projectId !== job.attempt.projectId ||
      snapshot.revision !== job.attempt.baseRevision ||
      snapshot.inputHash !== job.attempt.inputHash ||
      proof.video.width !== document.width ||
      proof.video.height !== document.height ||
      proof.video.fps !== document.fps ||
      proof.video.frames !== document.durationInFrames ||
      Math.abs(
        proof.video.durationMs -
          (document.durationInFrames / document.fps) * 1000,
      ) > 100 ||
      Math.abs(proof.audio.durationMs - proof.video.durationMs) > 100 ||
      new Set(input.parts.map((part) => part.versionId)).size !==
        input.parts.length
    )
      throw new StudioCommandError("INVALID")

    const assets = new StudioAssetService(this.db)
    const recorded = {
      attemptId: input.attemptId,
      leaseId: input.leaseId,
      profileId: STUDIO_RENDER_PROFILE.id,
      inputHash: snapshot.inputHash,
    }
    let totalBytes: number | undefined
    let retentionDeadlineMs: number | undefined
    for (const [index, reference] of input.parts.entries()) {
      signal?.throwIfAborted()
      const asset = await assets.read(user, reference)
      const provenance = asset.provenance.recorded
      const part = studioRenderOutputPartSchema.parse({
        index: provenance.partIndex,
        count: provenance.partCount,
        byteSize: asset.byteSize,
        totalBytes: provenance.outputBytes,
        outputDigest: provenance.outputDigest,
        retentionDeadlineMs: provenance.retentionDeadlineMs,
      })
      if (
        asset.actor.kind !== "service" ||
        asset.actor.id !== "manager_backend" ||
        asset.role !== "archive" ||
        asset.mimeType !== "application/octet-stream" ||
        asset.filename !== `${input.attemptId}-part-${index}.bin` ||
        asset.provenance.status !== "recorded" ||
        Object.entries(recorded).some(
          ([key, value]) => provenance[key] !== value,
        ) ||
        part.index !== index ||
        part.count !== input.parts.length ||
        part.outputDigest !== proof.outputDigest ||
        (totalBytes !== undefined && part.totalBytes !== totalBytes) ||
        (retentionDeadlineMs !== undefined &&
          part.retentionDeadlineMs !== retentionDeadlineMs)
      )
        throw new StudioCommandError("INVALID")
      totalBytes = part.totalBytes
      retentionDeadlineMs = part.retentionDeadlineMs
    }
    // Metadata is validated for every part before allocating or reading output bytes.
    if (!totalBytes || retentionDeadlineMs === undefined)
      throw new StudioCommandError("INVALID")
    const remaining = retentionDeadlineMs - Date.now()
    if (remaining <= 0 || remaining > STUDIO_RENDER_PROFILE.retentionTransferMs)
      throw new StudioCommandError("INVALID")
    const deadlineMs = retentionDeadlineMs
    const deadline = AbortSignal.timeout(remaining)
    const effectiveSignal = signal
      ? AbortSignal.any([signal, deadline])
      : deadline
    const checkActive = () => {
      effectiveSignal.throwIfAborted()
      if (Date.now() >= deadlineMs)
        throw new DOMException(
          "Render retention deadline exceeded",
          "TimeoutError",
        )
    }
    checkActive()
    const output = Buffer.alloc(totalBytes)
    let offset = 0
    for (const reference of input.parts) {
      checkActive()
      const bytes = await readVerifiedStudioAsset(
        this.db,
        reference,
        STUDIO_RENDER_OUTPUT_PART_BYTES,
        effectiveSignal,
      )
      checkActive()
      const expected = Math.min(
        STUDIO_RENDER_OUTPUT_PART_BYTES,
        output.length - offset,
      )
      if (bytes.length !== expected) throw new StudioCommandError("INVALID")
      output.set(bytes, offset)
      offset += bytes.length
    }
    if (offset !== output.length || byteDigest(output) !== proof.outputDigest)
      throw new StudioCommandError("INVALID")

    const retained: StudioAssetReference[] = []
    const register = async (
      filename: string,
      mimeType: string,
      role: "render" | "manifest",
      bytes: Buffer,
      dependencies: StudioAssetReference[],
    ) => {
      checkActive()
      const metadata = {
        filename,
        mimeType,
        role,
        dependencies,
        provenance: { status: "recorded", recorded },
      }
      const asset = await assets.register(
        user,
        {
          ...metadata,
          idempotencyKey: `render-retain:${studioHash({ metadata, digest: byteDigest(bytes) })}`,
        },
        bytes,
        undefined,
        effectiveSignal,
      )
      retained.push(asset.reference)
      checkActive()
      return asset.reference
    }
    try {
      const rendered = await register(
        `${input.attemptId}.mp4`,
        "video/mp4",
        "render",
        output,
        [],
      )
      const codec = await register(
        `${input.attemptId}-codec.json`,
        "application/json",
        "manifest",
        Buffer.from(JSON.stringify(proof)),
        [rendered],
      )
      const manifest = studioCatalogRenderManifestSchema.parse({
        version: 1,
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        renderAttemptId: input.attemptId,
        inputHash: snapshot.inputHash,
        output: rendered,
        language: document.language,
        runtimeVersion: document.runtimeVersion,
        width: document.width,
        height: document.height,
        fps: document.fps,
        durationInFrames: document.durationInFrames,
        verification: {
          status: "verified",
          verifierVersion: proof.verifierVersion,
          outputDigest: proof.outputDigest,
        },
      })
      const reference = await register(
        `${input.attemptId}-render.json`,
        "application/json",
        "manifest",
        Buffer.from(JSON.stringify(manifest)),
        [rendered, codec],
      )
      return studioAttemptResultSchema.parse({
        assets: retained,
        manifest: reference,
        costMicros: null,
        diagnostic: "Contained render independently decoded and retained",
      })
    } catch {
      return studioAttemptResultSchema.parse({
        assets: retained,
        costMicros: null,
        diagnostic: "Render retention incomplete; retained assets preserved",
      })
    }
  }
}
