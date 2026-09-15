import { z } from "zod"
import { getMux } from "./mux"
import { studioCatalogReadinessProofSchema } from "@forge/studio-contracts/publication-state"

/** Studio never uses the legacy public-playback ingest helper. A durable intent
 * must be consumed before calling this method; an ambiguous create is observed
 * and reconciled, never automatically retried as another provider purchase. */
// Upload URLs are bearer capabilities returned only to the assigned host.
export async function createStudioMuxUpload(
  intentId: string,
  signal: AbortSignal,
) {
  const upload = await getMux().video.uploads.create(
    {
      // Host PUTs have no Origin header; do not authorize a browser origin.
      cors_origin: "https://shorts-worker.invalid",
      timeout: 3600,
      new_asset_settings: {
        playback_policy: ["signed"],
        passthrough: z.string().min(1).max(255).parse(intentId),
        video_quality: "basic",
        max_resolution_tier: "2160p",
        master_access: "none",
      },
    },
    { maxRetries: 0, timeout: 30000, signal },
  )
  return z.object({ id: z.string().min(1) }).parse(upload)
}
export async function observeStudioMuxUpload(
  uploadId: string,
  signal: AbortSignal,
) {
  return z
    .object({
      id: z.string().min(1),
      status: z.string(),
      url: z.url().optional(),
      asset_id: z.string().optional(),
    })
    .parse(
      await getMux().video.uploads.retrieve(uploadId, {
        maxRetries: 0,
        timeout: 10000,
        signal,
      }),
    )
}
const muxAssetSchema = z.object({
  id: z.string().min(1),
  status: z.literal("ready"),
  passthrough: z.string(),
  duration: z.number().positive(),
  playback_ids: z.tuple([
    z.object({ id: z.string().min(1), policy: z.literal("signed") }),
  ]),
  tracks: z.array(
    z.object({
      type: z.string(),
      max_width: z.number().optional(),
      max_height: z.number().optional(),
      max_frame_rate: z.number().optional(),
      max_channels: z.number().optional(),
    }),
  ),
})
export class StudioMuxReadinessError extends Error {}
/** This is an authenticated API observation, not codec certification. The fresh
 * contained codec proof and registered digest are checked separately by Admin. */
export function studioMuxReadyProof(raw: unknown, intentId: string) {
  const asset = muxAssetSchema.parse(raw)
  if (asset.passthrough !== intentId)
    throw new StudioMuxReadinessError("Mux render intent mismatch")
  const videos = asset.tracks.filter((track) => track.type === "video"),
    audio = asset.tracks.filter((track) => track.type === "audio")
  if (videos.length !== 1 || audio.length !== 1 || !audio[0].max_channels)
    throw new StudioMuxReadinessError("Mux audio/video tracks required")
  return studioCatalogReadinessProofSchema.shape.mux.parse({
    assetId: asset.id,
    playbackId: asset.playback_ids[0].id,
    status: "ready",
    playbackPolicies: ["signed"],
    width: videos[0].max_width,
    height: videos[0].max_height,
    fps: videos[0].max_frame_rate,
    durationMs: asset.duration * 1000,
    audio: true,
  })
}
export async function observeStudioMuxAsset(
  assetId: string,
  intentId: string,
  signal: AbortSignal,
) {
  const asset = await getMux().video.assets.retrieve(assetId, {
    timeout: 15000,
    maxRetries: 0,
    signal,
  })
  if (asset.id !== assetId)
    throw new StudioMuxReadinessError("Mux asset mismatch")
  if (asset.status === "preparing") return { status: "preparing" as const }
  return {
    status: "ready" as const,
    proof: studioMuxReadyProof(asset, intentId),
    observedAt: new Date().toISOString(),
  }
}
