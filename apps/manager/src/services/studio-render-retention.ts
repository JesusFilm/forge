import { createHash } from "node:crypto"
import type {
  StudioDocument,
  StudioAssetReference,
} from "@forge/studio-contracts"
import {
  STUDIO_RENDER_PROFILE,
  studioCodecProofSchema,
} from "@forge/studio-contracts/render"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import {
  createStudioAssetBroker,
  type StudioBrokerClient,
} from "./studio-broker"
import {
  StudioRenderRetentionError,
  StudioRenderRunError,
} from "./studio-render-runner"

/** Trusted broker only: runtime authentication precedes this shared retention
 * path. Registration is content-idempotent and bound to the exact issued lease. */
export async function retainStudioRenderOutput(
  call: StudioBrokerClient,
  snapshot: {
    projectId: string
    revision: number
    inputHash: string
    document: StudioDocument
  },
  attemptId: string,
  leaseId: string,
  output: Buffer,
  rawProof: unknown,
  retentionSignal: AbortSignal,
) {
  const proof = studioCodecProofSchema.parse(rawProof)
  const document = snapshot.document
  if (
    !output.length ||
    output.length > STUDIO_RENDER_PROFILE.outputBytes ||
    createHash("sha256").update(output).digest("hex") !== proof.outputDigest ||
    proof.video.width !== document.width ||
    proof.video.height !== document.height ||
    proof.video.fps !== document.fps ||
    proof.video.frames !== document.durationInFrames ||
    Math.abs(
      proof.video.durationMs -
        (document.durationInFrames / document.fps) * 1000,
    ) > 100 ||
    Math.abs(proof.audio.durationMs - proof.video.durationMs) > 100
  )
    throw new StudioRenderRunError(
      "Render output proof does not match the immutable input",
    )
  const assets = createStudioAssetBroker(call, retentionSignal)
  const retained: StudioAssetReference[] = []
  const recorded = {
    attemptId,
    leaseId,
    profileId: STUDIO_RENDER_PROFILE.id,
    inputHash: snapshot.inputHash,
  }
  try {
    const rendered = await assets.register(
      `${attemptId}.mp4`,
      "video/mp4",
      "render",
      output,
      [],
      recorded,
    )
    retained.push(rendered)
    const codec = await assets.register(
      `${attemptId}-codec.json`,
      "application/json",
      "manifest",
      Buffer.from(JSON.stringify(proof)),
      [rendered],
      recorded,
    )
    retained.push(codec)
    const document = snapshot.document
    const manifest = studioCatalogRenderManifestSchema.parse({
      version: 1,
      projectId: snapshot.projectId,
      revision: snapshot.revision,
      renderAttemptId: attemptId,
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
    const reference = await assets.register(
      `${attemptId}-render.json`,
      "application/json",
      "manifest",
      Buffer.from(JSON.stringify(manifest)),
      [rendered, codec],
      recorded,
    )
    retained.push(reference)
    return {
      assets: retained,
      manifest: reference,
      costMicros: null,
      diagnostic: "Contained render independently decoded and retained",
    }
  } catch {
    throw new StudioRenderRetentionError({
      assets: retained,
      costMicros: null,
      diagnostic: "Render retention incomplete; retained assets preserved",
    })
  }
}
