import { StudioProductionPreflightError } from "./errors"
import {
  assertStudioNarrationCapacity,
  orderedStudioSpeech,
  studioPronunciationLocatorsSchema,
} from "@forge/studio-contracts/production"
import { z } from "zod"
import type { Prisma, PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  studioAssetReferenceSchema,
  studioCommandBaseSchema,
  studioDocumentSchema,
  studioIdSchema,
  type StudioAssetReference,
  type StudioDocument,
} from "@forge/studio-contracts"
import { studioRegisterAssetSchema } from "@forge/studio-contracts/assets"
import {
  StudioAssetService,
  readVerifiedStudioAsset,
  resolveAssetVersion,
} from "./assets"
import { StudioAuthoringService } from "./index"
import { StudioCommandError } from "./errors"
import { studioHash } from "./state"

const entrySchema = z
  .object({
    itemId: studioIdSchema,
    asset: studioAssetReferenceSchema,
    durationMs: z.number().int().positive().max(3_600_000),
  })
  .strict()
const chunkSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(entrySchema).min(1).max(64),
  })
  .strict()
const manifestSchema = z
  .object({
    version: z.literal(1),
    chunks: z.array(studioAssetReferenceSchema).min(1).max(16),
  })
  .strict()
export class StudioTimingConflict extends Error {
  constructor(public readonly itemIds: string[]) {
    super(
      `Timing reconciliation conflicts affect ${itemIds.length} items; inspect the retained revision and conflict indices`,
    )
  }
}
export class StudioNarrationService {
  constructor(private readonly db: PrismaClient) {}
  async plan(user: Principal | null, raw: unknown) {
    const input = z
      .object({
        projectId: studioIdSchema,
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(raw)
    const project = await new StudioAuthoringService(this.db).read(
      user,
      input.projectId,
    )
    if (project.revision !== input.expectedRevision)
      throw new StudioCommandError("CONFLICT")
    assertStudioNarrationCapacity(project.document)
    const assets = new StudioAssetService(this.db)
    const segments = []
    for (const item of orderedStudioSpeech(project.document)) {
      if (!item.speech || item.speech.suppressed || !item.speech.text.length)
        continue
      const identity = await assets.narrationIdentity(
        user,
        project.document.language,
        item.speech,
      )
      if (identity.text.length > 2000 || !identity.text.trim())
        throw new StudioProductionPreflightError(
          "Speech exceeds the 2,000-character provider preflight limit or is blank; visibly edit or segment it and approve the complete script again",
        )
      const code = identity.settings.language_code ?? identity.language
      if (
        typeof code !== "string" ||
        !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(code)
      )
        throw new StudioProductionPreflightError(
          "Select an inspectable provider language code before speech review",
        )
      if (code !== project.document.language) {
        const language = await this.db.language.findUnique({
          where: { slug: project.document.language },
          select: { bcp47: true },
        })
        if (language?.bcp47 !== code)
          throw new StudioProductionPreflightError(
            "Provider language must match the canonical project language",
          )
      }
      const pronunciationLocators = identity.pronunciation
        ? studioPronunciationLocatorsSchema
            .min(1)
            .parse(
              (await assets.read(user, identity.pronunciation)).provenance
                .recorded.locators,
            )
        : []
      segments.push({
        itemId: item.id,
        identity,
        pronunciationLocators,
        matches: (await assets.findNarration(user, identity))
          .filter((a) => {
            const duration = a.provenance.recorded.durationMs
            return (
              a.provenance.status === "recorded" &&
              a.provenance.recorded.mediaValidated !== false &&
              typeof duration === "number" &&
              Number.isSafeInteger(duration) &&
              duration > 0 &&
              duration <= 3600000
            )
          })
          .map((a) => a.reference),
      })
    }
    return {
      projectId: project.projectId,
      revision: project.revision,
      segments,
    }
  }
  async complete(user: Principal | null, raw: unknown) {
    const input = studioCommandBaseSchema
      .extend({
        attemptId: studioIdSchema,
        manifest: studioAssetReferenceSchema,
        costMicros: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable(),
      })
      .strict()
      .parse(raw)
    const { manifest, costMicros, ...command } = input
    return new StudioAuthoringService(this.db).complete(user, {
      ...command,
      status: "SUCCEEDED",
      operations: [],
      result: { assets: [], manifest, costMicros },
    })
  }
}

/** Verified manifest bytes, exact identity, attachment and timing run within the canonical project transaction. */
export async function attachStudioNarration(
  tx: Prisma.TransactionClient,
  document: StudioDocument,
  reference: StudioAssetReference,
): Promise<StudioDocument> {
  async function manifestBytes(
    ref: StudioAssetReference,
    dependencies: StudioAssetReference[],
  ) {
    const row = await resolveAssetVersion(tx, ref)
    const meta = studioRegisterAssetSchema.parse(row.metadata)
    if (
      row.role !== "manifest" ||
      dependencies.some(
        (d) => !meta.dependencies?.some((v) => studioHash(v) === studioHash(d)),
      )
    )
      throw new StudioCommandError("INVALID")
  }
  const manifest = manifestSchema.parse(
    JSON.parse(
      (await readVerifiedStudioAsset(tx, reference, 16384)).toString(),
    ),
  )
  await manifestBytes(reference, manifest.chunks)
  const entries: z.infer<typeof entrySchema>[] = []
  for (const ref of manifest.chunks) {
    const chunk = chunkSchema.parse(
      JSON.parse((await readVerifiedStudioAsset(tx, ref, 32768)).toString()),
    )
    await manifestBytes(
      ref,
      chunk.entries.map((e) => e.asset),
    )
    entries.push(...chunk.entries)
  }
  const spoken = orderedStudioSpeech(document).filter(
    (i) => i.speech && !i.speech.suppressed && i.speech.text.length > 0,
  )
  if (
    entries.length !== spoken.length ||
    new Set(entries.map((e) => e.itemId)).size !== entries.length
  )
    throw new StudioCommandError("INVALID")
  for (const item of spoken) {
    const entry = entries.find((e) => e.itemId === item.id)
    if (!entry || !item.speech) throw new StudioCommandError("INVALID")
    const speech = item.speech
    const preset = studioRegisterAssetSchema.parse(
      (await resolveAssetVersion(tx, speech.voice)).metadata,
    )
    const voice = preset.voice
    const metadata = studioRegisterAssetSchema.parse(
      (await resolveAssetVersion(tx, entry.asset)).metadata,
    )
    if (
      !voice ||
      preset.role !== "voice" ||
      preset.provenance.recorded.registrationStatus === "preview" ||
      voice.language !== document.language ||
      voice.provider !== speech.provider ||
      voice.model !== speech.model ||
      metadata.role !== "narration" ||
      metadata.provenance.recorded.durationMs !== entry.durationMs ||
      studioHash(metadata.narration) !==
        studioHash({
          text: speech.text,
          role: speech.role,
          language: document.language,
          provider: speech.provider,
          model: speech.model,
          voiceId: voice.voiceId,
          settings: speech.settings,
          pronunciation: speech.pronunciation,
        })
    )
      throw new StudioCommandError("INVALID")
  }
  const doc = structuredClone(document)
  const trailingGap =
    document.durationInFrames -
    Math.max(0, ...document.items.map((i) => i.startFrame + i.durationInFrames))
  for (const original of spoken) {
    const item = doc.items.find((i) => i.id === original.id)!,
      entry = entries.find((e) => e.itemId === item.id)!
    const frames = Math.ceil((entry.durationMs * doc.fps) / 1000),
      delta = frames - item.durationInFrames,
      end = item.startFrame + item.durationInFrames
    // Ripple the sequential track and explicit links, never unrelated tracks.
    const followingIds = new Set(
      doc.items
        .filter(
          (i) =>
            i.id !== item.id &&
            i.trackId === item.trackId &&
            i.startFrame >= end,
        )
        .map((i) => i.id),
    )
    const linkedIds = new Set([item.id])
    for (let pass = 0; pass < doc.items.length; pass++) {
      let changed = false
      for (const candidate of doc.items) {
        if (
          candidate.linkedTo &&
          followingIds.has(candidate.linkedTo) &&
          !followingIds.has(candidate.id)
        ) {
          followingIds.add(candidate.id)
          changed = true
        }
        if (
          candidate.linkedTo &&
          linkedIds.has(candidate.linkedTo) &&
          !linkedIds.has(candidate.id)
        ) {
          linkedIds.add(candidate.id)
          changed = true
        }
      }
      if (!changed) break
    }
    const following = doc.items.filter(
      (i) => followingIds.has(i.id) && !linkedIds.has(i.id),
    )
    const linked = doc.items.filter(
      (i) => i.id !== item.id && linkedIds.has(i.id),
    )
    const conflicts = [item, ...following].filter(
      (i) =>
        delta !== 0 &&
        (i.timingLocked || (i.id === item.id && i.kind === "video")),
    )
    conflicts.push(
      ...linked.filter(
        (i) =>
          (i.timingLocked || i.kind === "video") &&
          (i.startFrame !== item.startFrame || i.durationInFrames !== frames),
      ),
    )
    if (delta !== 0)
      conflicts.push(
        ...doc.items.filter(
          (i) =>
            i.id !== item.id &&
            i.trackId === item.trackId &&
            !linkedIds.has(i.id) &&
            i.startFrame < end &&
            i.startFrame + i.durationInFrames > item.startFrame,
        ),
      )
    // A partially overlapping linked item has no unique automatic resize.
    if (delta !== 0)
      conflicts.push(
        ...linked.filter(
          (i) =>
            i.startFrame !== item.startFrame ||
            i.durationInFrames !== item.durationInFrames,
        ),
      )
    if (delta !== 0)
      conflicts.push(
        ...linked.filter(
          (i) => i.speech && !i.speech.suppressed && i.speech.text.length > 0,
        ),
      )
    if (conflicts.length)
      throw new StudioTimingConflict([...new Set(conflicts.map((i) => i.id))])
    item.durationInFrames = frames
    for (const next of following) next.startFrame += delta
    for (const next of linked) {
      next.startFrame = item.startFrame
      next.durationInFrames = frames
    }
    const audioId = `narration-${studioHash(item.id).slice(0, 32)}`
    const priorAudio = doc.items.find((i) => i.id === audioId)
    if (
      priorAudio &&
      (priorAudio.kind !== "audio" || priorAudio.narrationFor !== item.id)
    )
      throw new StudioTimingConflict([priorAudio.id])
    doc.items = doc.items.filter((i) => i.id !== audioId)
    const trackId = "studio-narration"
    if (!doc.tracks.some((t) => t.id === trackId))
      doc.tracks.push({ id: trackId, kind: "audio" })
    doc.items.push({
      id: audioId,
      kind: "audio",
      trackId,
      linkedTo: item.id,
      narrationFor: item.id,
      startFrame: item.startFrame,
      durationInFrames: frames,
      sourceStartMs: 0,
      volume: priorAudio?.kind === "audio" ? priorAudio.volume : 1,
      timingLocked: priorAudio?.timingLocked,
      asset: entry.asset,
    })
  }
  doc.durationInFrames =
    Math.max(1, ...doc.items.map((i) => i.startFrame + i.durationInFrames)) +
    trailingGap
  const checked = studioDocumentSchema.safeParse(doc)
  if (!checked.success)
    throw new StudioTimingConflict(spoken.map((item) => item.id))
  return checked.data
}
