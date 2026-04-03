// Mux service — video asset management and streaming.
// Docs: https://docs.mux.com

import Mux from "@mux/mux-node"
import { env } from "@/config/env"
import { normalizeGeneratedSubtitleLanguage } from "@/lib/mux-language"

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
  subtitleLanguageCode?: string
}

export type MuxAssetInfo = {
  assetId: string
  playbackId: string
  status: string
  duration: number | null
}

export { normalizeGeneratedSubtitleLanguage }

export function buildMuxAssetCreateParams(
  options: CreateAssetOptions,
): Mux.Video.AssetCreateParams {
  const subtitleLanguageCode = normalizeGeneratedSubtitleLanguage(
    options.subtitleLanguageCode,
  )
  const input: Mux.Video.AssetCreateParams.Input[] = [
    {
      url: options.inputUrl,
      ...(options.generateSubtitles && {
        generated_subtitles: [
          {
            language_code:
              subtitleLanguageCode as Mux.Video.AssetCreateParams.Input.GeneratedSubtitle["language_code"],
            name: "Generated subtitles",
          },
        ],
      }),
    },
  ]

  return {
    input,
    // Manager-created assets need a public playback ID because the workflow
    // fetches generated VTT files directly and the current UI links straight to
    // Mux's public player URL.
    playback_policy: ["public"],
    passthrough: options.passthrough,
  }
}

export async function createMuxAsset(
  options: CreateAssetOptions,
): Promise<MuxAssetInfo> {
  const asset = await getMux().video.assets.create(
    buildMuxAssetCreateParams(options),
  )

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
