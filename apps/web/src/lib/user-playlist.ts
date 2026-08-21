import "server-only"

import { hasUiLocale } from "@/i18n/locales"
import {
  DEFAULT_LOCALE,
  publicWatchAudioLanguageSlugForLocale,
  type UiLocale,
} from "@/lib/locale"
import {
  resolvePublicUserPlaylistAtBoundary,
  type PublicUserPlaylistBoundaryResult,
} from "./user-playlist-public-boundary"
import type { PublicUserPlaylist } from "./user-playlist-public-contract"
import { PUBLIC_USER_PLAYLIST_VIDEOS_QUERY_SOURCE } from "./user-playlist-public-operations"

const VIDEO_BATCH_SIZE = 20
const VIDEO_BATCH_CONCURRENCY = 4
const VIDEO_RESPONSE_LIMIT = 2_000_000
const VIDEO_TIMEOUT_MS = 5_000
const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/

export type PublicUserPlaylistVideo = {
  id: string
  slug: string
  title: string
  description: string
  imageUrl: string | null
  imageAlt: string
  blurDataUrl: string | null
  dominantColor: string | null
  label: string | null
  durationSeconds: number | null
  languageSlug: string
}

export type LoadedPublicUserPlaylist = {
  playlist: PublicUserPlaylist
  videos: PublicUserPlaylistVideo[]
  uiLocale: UiLocale
  languageSlug: string
}

export type PublicUserPlaylistPageResult =
  | { kind: "available"; data: LoadedPublicUserPlaylist }
  | Exclude<PublicUserPlaylistBoundaryResult, { kind: "available" }>

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeRemoteUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function imageFrom(value: unknown): {
  url: string | null
  blurDataUrl: string | null
  dominantColor: string | null
} {
  if (!Array.isArray(value)) {
    return { url: null, blurDataUrl: null, dominantColor: null }
  }
  for (const candidate of value) {
    const image = record(candidate)
    if (!image) continue
    const url =
      safeRemoteUrl(image.mobileCinematicHigh) ??
      safeRemoteUrl(image.thumbnail) ??
      safeRemoteUrl(image.videoStill) ??
      safeRemoteUrl(image.mobileCinematicLow) ??
      safeRemoteUrl(image.url)
    if (!url) continue
    return {
      url,
      blurDataUrl:
        typeof image.blurDataUrl === "string" &&
        image.blurDataUrl.startsWith("data:image/") &&
        image.blurDataUrl.length <= 20_000
          ? image.blurDataUrl
          : null,
      dominantColor:
        typeof image.dominantColor === "string" &&
        /^#[0-9A-Fa-f]{6}$/.test(image.dominantColor)
          ? image.dominantColor
          : null,
    }
  }
  return { url: null, blurDataUrl: null, dominantColor: null }
}

function adaptVideo(
  value: unknown,
  requestedIds: ReadonlySet<string>,
  fallbackLanguageSlug: string,
): PublicUserPlaylistVideo | null {
  const video = record(value)
  if (
    !video ||
    typeof video.id !== "string" ||
    !requestedIds.has(video.id) ||
    typeof video.slug !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(video.slug) ||
    video.noIndex !== false
  ) {
    return null
  }
  const variant = record(video.preferredPlayableDub)
  if (!variant || typeof variant.hls !== "string" || !variant.hls.trim()) {
    return null
  }
  const locale = Array.isArray(video.locales) ? record(video.locales[0]) : null
  const title =
    typeof locale?.title === "string" && locale.title.trim()
      ? locale.title.slice(0, 240)
      : video.slug
  const description =
    typeof locale?.snippet === "string"
      ? locale.snippet.slice(0, 500)
      : typeof locale?.description === "string"
        ? locale.description.slice(0, 500)
        : ""
  const image = imageFrom(video.images)
  const language = record(variant.language)
  const languageSlug =
    typeof language?.slug === "string" &&
    /^[a-z0-9][a-z0-9-]{0,100}$/.test(language.slug)
      ? language.slug
      : fallbackLanguageSlug
  const durationCandidate =
    typeof variant.duration === "number"
      ? variant.duration
      : video.durationSeconds

  return {
    id: video.id,
    slug: video.slug,
    title,
    description,
    imageUrl: image.url,
    imageAlt:
      typeof locale?.imageAlt === "string" && locale.imageAlt.trim()
        ? locale.imageAlt.slice(0, 300)
        : title,
    blurDataUrl: image.blurDataUrl,
    dominantColor: image.dominantColor,
    label: typeof video.label === "string" ? video.label : null,
    durationSeconds:
      typeof durationCandidate === "number" &&
      Number.isFinite(durationCandidate) &&
      durationCandidate >= 0
        ? durationCandidate
        : null,
    languageSlug,
  }
}

function videoIds(playlist: PublicUserPlaylist): string[] {
  return [
    ...new Set(
      playlist.blocks.flatMap((block) =>
        "videoIds" in block ? block.videoIds : [],
      ),
    ),
  ].filter((id) => MEDIA_ID_PATTERN.test(id))
}

function batch<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

async function fetchVideoBatch(input: {
  ids: string[]
  locale: string
  languageSlug: string
  adminGraphqlUrl: string
  consumerBearer: string
}): Promise<PublicUserPlaylistVideo[]> {
  const first = input.ids[0]
  if (!first) return []
  const variables: Record<string, string> = {
    locale: input.locale,
    languageSlug: input.languageSlug,
  }
  for (let index = 0; index < VIDEO_BATCH_SIZE; index += 1) {
    variables[`id${index}`] = input.ids[index] ?? first
  }
  let response: Response
  try {
    response = await fetch(input.adminGraphqlUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.consumerBearer}`,
      },
      body: JSON.stringify({
        operationName: "PublicUserPlaylistVideos",
        query: PUBLIC_USER_PLAYLIST_VIDEOS_QUERY_SOURCE,
        variables,
      }),
    })
  } catch {
    return []
  }
  if (!response.ok) return []
  const length = Number(response.headers.get("content-length") ?? "0")
  if (length > VIDEO_RESPONSE_LIMIT) return []
  let text: string
  try {
    text = await response.text()
  } catch {
    return []
  }
  if (text.length > VIDEO_RESPONSE_LIMIT) return []
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return []
  }
  const root = record(payload)
  const data = record(root?.data)
  if (!data || Array.isArray(root?.errors)) return []
  const requestedIds = new Set(input.ids)
  const videos: PublicUserPlaylistVideo[] = []
  for (let index = 0; index < VIDEO_BATCH_SIZE; index += 1) {
    const video = adaptVideo(
      data[`video${index}`],
      requestedIds,
      input.languageSlug,
    )
    if (video && !videos.some((candidate) => candidate.id === video.id)) {
      videos.push(video)
    }
  }
  return videos
}

async function hydrateVideos(input: {
  playlist: PublicUserPlaylist
  uiLocale: UiLocale
  languageSlug: string
}): Promise<PublicUserPlaylistVideo[]> {
  const adminGraphqlUrl = process.env.ADMIN_GRAPHQL_URL
  const consumerBearer = process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim()
  if (!adminGraphqlUrl || !consumerBearer) return []
  const batches = batch(videoIds(input.playlist), VIDEO_BATCH_SIZE)
  const output: PublicUserPlaylistVideo[] = []
  let next = 0

  await Promise.all(
    Array.from(
      { length: Math.min(VIDEO_BATCH_CONCURRENCY, batches.length) },
      async () => {
        while (next < batches.length) {
          const current = batches[next]
          next += 1
          if (!current) continue
          output.push(
            ...(await fetchVideoBatch({
              ids: current,
              locale: input.uiLocale,
              languageSlug: input.languageSlug,
              adminGraphqlUrl,
              consumerBearer,
            })),
          )
        }
      },
    ),
  )

  const byId = new Map(output.map((video) => [video.id, video]))
  return videoIds(input.playlist).flatMap((id) => {
    const video = byId.get(id)
    return video ? [video] : []
  })
}

export async function loadPublicUserPlaylist(input: {
  capability: string
  requestHeaders: Headers
}): Promise<PublicUserPlaylistPageResult> {
  const resolved = await resolvePublicUserPlaylistAtBoundary(input)
  if (resolved.kind !== "available") return resolved
  const uiLocale = hasUiLocale(resolved.playlist.locale)
    ? (resolved.playlist.locale as UiLocale)
    : DEFAULT_LOCALE
  const languageSlug =
    publicWatchAudioLanguageSlugForLocale(resolved.playlist.locale) ??
    publicWatchAudioLanguageSlugForLocale(uiLocale) ??
    "english"
  return {
    kind: "available",
    data: {
      playlist: resolved.playlist,
      videos: await hydrateVideos({
        playlist: resolved.playlist,
        uiLocale,
        languageSlug,
      }),
      uiLocale,
      languageSlug,
    },
  }
}
