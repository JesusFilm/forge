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

type MuxTrackInfo = {
  id?: string | null
  type?: "video" | "audio" | "text" | null
  text_type?: "subtitles" | null
  text_source?:
    | "uploaded"
    | "embedded"
    | "generated_live"
    | "generated_live_final"
    | "generated_vod"
    | null
  language_code?: string | null
  status?: "preparing" | "ready" | "errored" | "deleted" | null
  primary?: boolean | null
}

type MuxAssetTrackSnapshot = {
  tracks?: MuxTrackInfo[] | null
}

export type EnsureGeneratedSubtitlesDeps = {
  retrieveAsset?: (assetId: string) => Promise<MuxAssetTrackSnapshot>
  generateSubtitles?: (
    assetId: string,
    trackId: string,
    params: Mux.Video.AssetGenerateSubtitlesParams,
  ) => Promise<unknown>
}

function isGeneratedSubtitleTrack(
  track: MuxTrackInfo,
  languageCode: string,
): boolean {
  return (
    track.type === "text" &&
    track.text_type === "subtitles" &&
    track.text_source === "generated_vod" &&
    track.language_code?.toLowerCase() === languageCode.toLowerCase()
  )
}

function hasReusableReadySubtitleTrack(
  track: MuxTrackInfo,
  languageCode: string,
): boolean {
  if (
    track.type !== "text" ||
    track.text_type !== "subtitles" ||
    track.status !== "ready"
  ) {
    return false
  }

  const normalizedTrackLanguage = track.language_code?.toLowerCase()
  return (
    normalizedTrackLanguage === languageCode.toLowerCase() ||
    normalizedTrackLanguage === "auto"
  )
}

function choosePrimaryAudioTrack(
  tracks: MuxTrackInfo[],
): (MuxTrackInfo & { id: string }) | null {
  const audioTracks = tracks.filter(
    (track): track is MuxTrackInfo & { id: string } =>
      track.type === "audio" && Boolean(track.id),
  )

  return audioTracks.find((track) => track.primary) ?? audioTracks[0] ?? null
}

export async function ensureGeneratedSubtitlesForAsset(
  assetId: string,
  subtitleLanguageCode: string,
  deps: EnsureGeneratedSubtitlesDeps = {},
): Promise<void> {
  const normalizedLanguageCode =
    normalizeGeneratedSubtitleLanguage(subtitleLanguageCode)
  if (normalizedLanguageCode === "auto") {
    throw new Error(
      `Cannot request generated subtitles for unsupported language ${subtitleLanguageCode}`,
    )
  }

  const retrieveAsset =
    deps.retrieveAsset ??
    ((targetAssetId: string) => getMux().video.assets.retrieve(targetAssetId))
  const generateSubtitles =
    deps.generateSubtitles ??
    ((targetAssetId: string, trackId: string, params) =>
      getMux().video.assets.generateSubtitles(targetAssetId, trackId, params))

  const asset = await retrieveAsset(assetId)
  const tracks = asset.tracks ?? []
  const reusableReadyTrack = tracks.find((track) =>
    hasReusableReadySubtitleTrack(track, normalizedLanguageCode),
  )
  if (reusableReadyTrack) {
    return
  }

  const matchingGeneratedTrack = tracks.find((track) =>
    isGeneratedSubtitleTrack(track, normalizedLanguageCode),
  )

  if (
    matchingGeneratedTrack?.status === "ready" ||
    matchingGeneratedTrack?.status === "preparing"
  ) {
    return
  }

  if (matchingGeneratedTrack?.status === "errored") {
    throw new Error(
      `Mux asset ${assetId} has an errored generated subtitle track for ${normalizedLanguageCode}`,
    )
  }

  const audioTrack = choosePrimaryAudioTrack(tracks)
  if (!audioTrack) {
    throw new Error(
      `Mux asset ${assetId} has no audio track for subtitle generation`,
    )
  }

  await generateSubtitles(assetId, audioTrack.id, {
    generated_subtitles: [
      {
        language_code:
          normalizedLanguageCode as Mux.Video.AssetGenerateSubtitlesParams.GeneratedSubtitle["language_code"],
        name: "Generated subtitles",
      },
    ],
  })
}

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
  const playbackId = asset.playback_ids?.[0]?.id
  if (!playbackId) {
    throw new Error(`Mux asset ${assetId} has no playback ID`)
  }

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
  if (options?.width != null) params.set("width", String(options.width))
  if (options?.time != null) params.set("time", String(options.time))
  const qs = params.toString()
  return `https://image.mux.com/${playbackId}/thumbnail.webp${qs ? `?${qs}` : ""}`
}

/**
 * Generate thumbnail URLs for scene analysis — extracts representative frames
 * at specified timestamps. Mux thumbnail API is public (no signing needed for
 * Core API-synced assets) and CDN-cached at no extra cost.
 */
export function getSceneThumbnailUrls(
  playbackId: string,
  startSeconds: number,
  endSeconds: number | null,
  count: number = 3,
): string[] {
  if (!playbackId) {
    throw new Error("Cannot generate thumbnail URLs: playbackId is empty")
  }

  const end = endSeconds ?? startSeconds + 60
  const duration = end - startSeconds

  if (count === 1 || duration <= 0) {
    return [getThumbnailUrl(playbackId, { width: 768, time: startSeconds })]
  }

  const urls: string[] = []
  for (let i = 0; i < count; i++) {
    const time = startSeconds + (duration * i) / (count - 1)
    urls.push(
      getThumbnailUrl(playbackId, { width: 768, time: Math.round(time) }),
    )
  }
  return urls
}
