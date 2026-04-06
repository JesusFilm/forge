// Mux service — video asset management and streaming.
// Docs: https://docs.mux.com

import Mux from "@mux/mux-node"
import { env } from "@/config/env"

let _mux: Mux | undefined
export function getMux(): Mux {
  if (!_mux) {
    _mux = new Mux({
      tokenId: env.MUX_TOKEN_ID,
      tokenSecret: env.MUX_TOKEN_SECRET,
      jwtSigningKey: env.MUX_SIGNING_KEY ?? null,
      jwtPrivateKey: env.MUX_PRIVATE_KEY ?? null,
    })
  }
  return _mux
}

export type CreateAssetOptions = {
  inputUrl: string
  passthrough?: string
  generateSubtitles?: boolean
}

export type MuxAssetInfo = {
  assetId: string
  playbackId: string
  status: string
  duration: number | null
}

export async function createMuxAsset(
  options: CreateAssetOptions,
): Promise<MuxAssetInfo> {
  const input: Mux.Video.AssetCreateParams.Input[] = [
    {
      url: options.inputUrl,
      ...(options.generateSubtitles && {
        generated_subtitles: [{ language_code: "en", name: "English" }],
      }),
    },
  ]

  const asset = await getMux().video.assets.create({
    input,
    playback_policy: ["signed"],
    passthrough: options.passthrough,
  })

  const playbackId = asset.playback_ids?.[0]?.id ?? ""

  return {
    assetId: asset.id,
    playbackId,
    status: asset.status ?? "preparing",
    duration: asset.duration ?? null,
  }
}

export async function getMuxAsset(assetId: string): Promise<MuxAssetInfo> {
  const asset = await getMux().video.assets.retrieve(assetId)
  const playbackId = asset.playback_ids?.[0]?.id ?? ""

  return {
    assetId: asset.id,
    playbackId,
    status: asset.status ?? "unknown",
    duration: asset.duration ?? null,
  }
}

export function getPlaybackUrl(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

export function getThumbnailUrl(
  playbackId: string,
  options?: { width?: number; time?: number },
): string {
  const params = new URLSearchParams()
  if (options?.width) params.set("width", String(options.width))
  if (options?.time) params.set("time", String(options.time))
  const qs = params.toString()
  return `https://image.mux.com/${playbackId}/thumbnail.webp${qs ? `?${qs}` : ""}`
}

export type Mp4Quality = "low" | "medium" | "high"

/**
 * Generate a signed MP4 URL for a Mux asset. Used by scene analysis (feat-040)
 * to pass video to Gemini for multimodal analysis.
 *
 * Requires MUX_SIGNING_KEY and MUX_PRIVATE_KEY to be configured.
 */
export async function getSignedMp4Url(
  playbackId: string,
  options?: { quality?: Mp4Quality },
): Promise<string> {
  if (!env.MUX_SIGNING_KEY || !env.MUX_PRIVATE_KEY) {
    throw new Error(
      "MUX_SIGNING_KEY and MUX_PRIVATE_KEY are required for signed MP4 URLs",
    )
  }
  if (!playbackId) {
    throw new Error("Cannot generate signed URL: playbackId is empty")
  }
  const quality = options?.quality ?? "medium"
  const token = await getMux().jwt.signPlaybackId(playbackId, {
    type: "video",
    expiration: "15m",
  })
  return `https://stream.mux.com/${playbackId}/${quality}.mp4?token=${token}`
}
