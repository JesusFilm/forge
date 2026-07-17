// Mux service — video asset management and streaming.
// Docs: https://docs.mux.com

import type Mux from "@mux/mux-node"
import { env } from "@/config/env"
import { normalizeGeneratedSubtitleLanguage } from "@/lib/mux-language"

declare const require: (id: string) => unknown

let _mux: Mux | undefined
function loadMuxClient(): typeof Mux {
  const muxModule = require("@mux/mux-node") as
    | { default?: typeof Mux }
    | typeof Mux
  return "default" in muxModule && muxModule.default
    ? muxModule.default
    : (muxModule as typeof Mux)
}

export function getMux(): Mux {
  if (!_mux) {
    const MuxClient = loadMuxClient()
    _mux = new MuxClient({
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
  publicPlaybackId?: string | null
  status: string
  duration: number | null
  staticRenditions?: MuxStaticRenditionInfo[]
}

export { normalizeGeneratedSubtitleLanguage }

export type MuxPlaybackPolicy = "public" | "signed" | "drm"

export type MuxStaticRenditionInfo = {
  name: string
  status: string | null
  width: number | null
  height: number | null
  type: string | null
}

type MuxPlaybackId = {
  id?: string | null
  policy?: MuxPlaybackPolicy | null
}

type MuxStaticRenditionFile = {
  name?: string | null
  status?: string | null
  width?: number | null
  height?: number | null
  type?: string | null
}

type MuxStaticRenditionsSnapshot = {
  files?: MuxStaticRenditionFile[] | null
}

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
  playback_ids?: MuxPlaybackId[] | null
  tracks?: MuxTrackInfo[] | null
}

export type MuxSubtitleTextTrack = {
  id: string
  languageCode: string
  label: string
  src: string
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

function choosePlaybackId(
  playbackIds: MuxPlaybackId[] | null | undefined,
): { id: string; policy: MuxPlaybackPolicy } | null {
  const available = (playbackIds ?? []).filter(
    (playbackId): playbackId is { id: string; policy: MuxPlaybackPolicy } =>
      Boolean(playbackId.id) && Boolean(playbackId.policy),
  )

  return (
    available.find((playbackId) => playbackId.policy === "public") ??
    available.find((playbackId) => playbackId.policy === "signed") ??
    available.find((playbackId) => playbackId.policy === "drm") ??
    null
  )
}

function choosePublicPlaybackId(
  playbackIds: MuxPlaybackId[] | null | undefined,
): string | null {
  return (
    (playbackIds ?? []).find(
      (playbackId) => playbackId.policy === "public" && Boolean(playbackId.id),
    )?.id ?? null
  )
}

function normalizeStaticRenditions(
  staticRenditions: MuxStaticRenditionsSnapshot | null | undefined,
): MuxStaticRenditionInfo[] {
  return (staticRenditions?.files ?? []).flatMap((file) => {
    const name = file.name?.trim()
    if (!name) {
      return []
    }

    return [
      {
        name,
        status: file.status ?? null,
        width: file.width ?? null,
        height: file.height ?? null,
        type: file.type ?? null,
      },
    ]
  })
}

function scoreStaticRendition(file: MuxStaticRenditionInfo): number {
  const nameHeight = file.name.match(/(\d{3,4})p\.mp4$/i)?.[1]
  const height =
    file.height ?? (nameHeight != null ? Number(nameHeight) : undefined)

  return height ?? 0
}

export function getMuxStaticRenditionSourceUrl(
  asset: Pick<MuxAssetInfo, "publicPlaybackId" | "staticRenditions">,
): string | null {
  if (!asset.publicPlaybackId) {
    return null
  }

  const readyMp4Renditions = (asset.staticRenditions ?? [])
    .filter(
      (file) =>
        file.status === "ready" && file.name.toLowerCase().endsWith(".mp4"),
    )
    .sort(
      (left, right) => scoreStaticRendition(right) - scoreStaticRendition(left),
    )

  const rendition = readyMp4Renditions[0]
  if (!rendition) {
    return null
  }

  return `https://stream.mux.com/${asset.publicPlaybackId}/${rendition.name}`
}

export async function buildMuxTextTrackUrl(
  playbackId: string,
  trackId: string,
  playbackPolicy: MuxPlaybackPolicy,
): Promise<string> {
  if (playbackPolicy === "drm") {
    throw new Error("DRM playback IDs are not supported for text tracks.")
  }

  const url = new URL(
    `https://stream.mux.com/${playbackId}/text/${trackId}.vtt`,
  )

  if (playbackPolicy === "signed") {
    if (!env.MUX_SIGNING_KEY || !env.MUX_PRIVATE_KEY) {
      throw new Error(
        "Mux signing keys are required to fetch subtitles from signed playback assets.",
      )
    }

    const token = await getMux().jwt.signPlaybackId(playbackId, {
      type: "video",
      expiration: "5m",
    })
    url.searchParams.set("token", token)
  }

  return url.toString()
}

export async function listMuxSubtitleTracks(
  assetId: string,
): Promise<MuxSubtitleTextTrack[]> {
  const asset = await getMux().video.assets.retrieve(assetId)
  const playback = choosePlaybackId(asset.playback_ids)
  if (!playback) {
    return []
  }

  const readyTracks = (asset.tracks ?? []).flatMap((track) => {
    if (
      track.type !== "text" ||
      track.text_type !== "subtitles" ||
      track.status !== "ready" ||
      typeof track.id !== "string" ||
      typeof track.language_code !== "string"
    ) {
      return []
    }

    return [
      {
        id: track.id,
        languageCode: track.language_code.trim().toLowerCase(),
        label:
          track.language_code.trim().toUpperCase() === "AUTO"
            ? "AUTO"
            : track.language_code.trim().toUpperCase(),
      },
    ]
  })

  const resolved = await Promise.all(
    readyTracks.map(async (track) => ({
      ...track,
      src: await buildMuxTextTrackUrl(playback.id, track.id, playback.policy),
    })),
  )

  return resolved.sort((left, right) =>
    left.languageCode.localeCompare(right.languageCode),
  )
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
  const publicPlaybackId = choosePublicPlaybackId(asset.playback_ids)

  return {
    assetId: asset.id,
    playbackId,
    publicPlaybackId,
    status: asset.status ?? "preparing",
    duration: asset.duration ?? null,
    staticRenditions: normalizeStaticRenditions(asset.static_renditions),
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
    publicPlaybackId: choosePublicPlaybackId(asset.playback_ids),
    status: asset.status ?? "unknown",
    duration: asset.duration ?? null,
    staticRenditions: normalizeStaticRenditions(asset.static_renditions),
  }
}

// Shorts Studio needs the playback POLICY, which getMuxAsset discards (it
// returns the first playback id regardless of policy). Shorts sources must
// be PUBLIC: the shorts-worker fetches the stream.mux.com HLS URL
// unauthenticated, so a signed/drm-only asset is ineligible (plan
// 2026-06-11-002 SpecFlow I6 — the routes surface `playback_not_public`).
export type MuxAssetPlaybackInfo = {
  assetId: string
  status: string
  duration: number | null
  /** First playback id with policy "public" — null when the asset only has
   * signed/drm playback policies (or none at all). */
  publicPlaybackId: string | null
}

export async function getMuxAssetPlayback(
  assetId: string,
): Promise<MuxAssetPlaybackInfo> {
  const asset = await getMux().video.assets.retrieve(assetId)
  const publicPlayback = (asset.playback_ids ?? []).find(
    (playback) => playback.policy === "public" && Boolean(playback.id),
  )

  return {
    assetId: asset.id,
    status: asset.status ?? "unknown",
    duration: asset.duration ?? null,
    publicPlaybackId: publicPlayback?.id ?? null,
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
