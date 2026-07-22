import type {
  WatchHomeMuxInsertAction,
  WatchHomeMuxInsertConfig,
  WatchHomeMuxInsertCopyId,
} from "@/lib/watch-home-config"

export const WATCH_HOME_TV_ADVANCE_THRESHOLD = 95
export const WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY = "carousel-played-ids"
export const WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY = "carousel-current-video"
export const WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY = "mux-insert-selections"
export const WATCH_HOME_TV_MUX_SELECTIONS_SEED_STORAGE_KEY =
  "mux-insert-selections-seed"

export type WatchHomeTvCarouselVideoSlide = {
  kind: "video"
  id: string
  videoId?: string
  title: string
  description: string | null
  label: string
  href: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string
  src: string | null
  playbackId: string | null
  subtitleVttSrc?: string | null
  subtitleLanguageBcp47?: string | null
  durationSeconds: number | null
  poolId?: string
  poolIndex?: number
}

export type WatchHomeTvCarouselMuxSlide = {
  kind: "mux"
  id: string
  copyId: WatchHomeMuxInsertCopyId
  href: string | null
  action: WatchHomeMuxInsertAction | null
  secondaryAction: { type: "watch-short-film" } | null
  posterUrl: string | null
  thumbnailUrl: string | null
  src: string | null
  playbackId: string | null
  durationSeconds: number | null
  logo: boolean
  playbackIndex: number
  titleDate: string | null
}

export type WatchHomeTvCarouselSlide =
  | WatchHomeTvCarouselVideoSlide
  | WatchHomeTvCarouselMuxSlide

export type WatchHomeCarouselPool = {
  id: string
  collectionIds: readonly string[]
  videos: readonly WatchHomeTvCarouselVideoSlide[]
}

export type WatchHomeCarouselSequenceData = {
  pools: readonly WatchHomeCarouselPool[]
  muxInserts: readonly WatchHomeMuxInsertConfig[]
}

export type WatchHomeCurrentVideoSession = {
  videoId: string
  videoTitle: string
  poolIndex: number
  poolId: string
  timestamp: number
}

type PlayedIdsStorageValue = {
  month?: unknown
  ids?: unknown
}

type QueueBuildInput = {
  pools: readonly WatchHomeCarouselPool[]
  existingVideos?: readonly WatchHomeTvCarouselVideoSlide[]
  playedIds?: readonly string[]
  startPoolIndex?: number
  targetVideoCount: number
  now?: Date
  useStoredProgress?: boolean
}

function simpleHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash &= hash
  }
  return Math.abs(hash)
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function currentStorageMonth(now = new Date()) {
  return now.toISOString().slice(0, 7)
}

function businessDate(now: Date) {
  return now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  })
}

export function getWatchHomeDeterministicOffset(
  poolId: string,
  videoCount: number,
  options: {
    now?: Date
    poolIndex?: number
    totalVideosLoaded?: number
  } = {},
): number {
  if (videoCount <= 0) return 0

  const now = options.now ?? new Date()
  let seed = `${businessDate(now)}${poolId}`

  if (options.poolIndex != null) {
    seed += `-cycle${Math.floor(options.poolIndex / 15)}`
  }
  if (options.totalVideosLoaded != null) {
    seed += `-prog${Math.floor(options.totalVideosLoaded / 10)}`
  }

  return simpleHash(seed) % videoCount
}

export function readWatchHomeTvPlayedIds(now = new Date()): string[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
    if (!stored) return []

    const data = JSON.parse(stored) as PlayedIdsStorageValue
    if (data.month !== currentStorageMonth(now)) {
      localStorage.removeItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
      return []
    }

    return Array.isArray(data.ids)
      ? data.ids.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}

export function resetWatchHomeTvPlayedIds() {
  if (typeof window === "undefined") return

  try {
    localStorage.removeItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function addWatchHomeTvPlayedId(slideId: string, now = new Date()) {
  if (typeof window === "undefined") return

  try {
    const current = readWatchHomeTvPlayedIds(now)
    const ids = current.includes(slideId) ? current : [...current, slideId]
    localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({
        month: currentStorageMonth(now),
        ids,
      }),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function poolVideosStorageKey(poolId: string) {
  return `pool-${poolId}-videos`
}

export function poolFailuresStorageKey(poolId: string) {
  return `pool-${poolId}-failures`
}

export function readWatchHomePoolPlayedIds(poolId: string): string[] {
  if (typeof window === "undefined") return []

  try {
    const value = sessionStorage.getItem(poolVideosStorageKey(poolId))
    return safeParseJson<string[]>(value, []).filter(
      (id): id is string => typeof id === "string",
    )
  } catch {
    return []
  }
}

function readWatchHomePoolFailures(poolId: string): number {
  if (typeof window === "undefined") return 0

  try {
    const value = sessionStorage.getItem(poolFailuresStorageKey(poolId))
    const failures = Number.parseInt(value ?? "0", 10)
    return Number.isFinite(failures) ? failures : 0
  } catch {
    return 0
  }
}

function resetWatchHomePoolFailures(poolId: string) {
  if (typeof window === "undefined") return

  try {
    sessionStorage.removeItem(poolFailuresStorageKey(poolId))
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

function markWatchHomePoolFailure(poolId: string, videoCount: number) {
  if (typeof window === "undefined") return

  try {
    const failures = readWatchHomePoolFailures(poolId) + 1
    sessionStorage.setItem(poolFailuresStorageKey(poolId), String(failures))

    if (failures < 3) return

    const played = readWatchHomePoolPlayedIds(poolId)
    const exhausted = [...played]
    for (let index = exhausted.length; index < videoCount; index++) {
      exhausted.push(`exhausted-${index}`)
    }
    sessionStorage.setItem(
      poolVideosStorageKey(poolId),
      JSON.stringify(exhausted),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function isWatchHomePoolExhausted(poolId: string, videoCount: number) {
  if (videoCount <= 0) return true
  return new Set(readWatchHomePoolPlayedIds(poolId)).size >= videoCount
}

export function markWatchHomePoolVideoPlayed(poolId: string, videoId: string) {
  if (typeof window === "undefined") return

  try {
    const current = readWatchHomePoolPlayedIds(poolId)
    if (current.includes(videoId)) return
    sessionStorage.setItem(
      poolVideosStorageKey(poolId),
      JSON.stringify([...current, videoId]),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function markWatchHomeVideoPlayed(
  slide: WatchHomeTvCarouselSlide | null,
) {
  if (!slide || slide.kind !== "video") return

  addWatchHomeTvPlayedId(slide.id)
  if (slide.poolId) {
    markWatchHomePoolVideoPlayed(slide.poolId, slide.id)
  }
}

export function saveWatchHomeCurrentVideoSession(
  slide: WatchHomeTvCarouselSlide | null,
) {
  if (typeof window === "undefined" || !slide || slide.kind !== "video") {
    return
  }

  try {
    const session: WatchHomeCurrentVideoSession = {
      videoId: slide.id,
      videoTitle: slide.title,
      poolIndex: slide.poolIndex ?? 0,
      poolId: slide.poolId ?? "unknown",
      timestamp: Date.now(),
    }
    sessionStorage.setItem(
      WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
      JSON.stringify(session),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function loadWatchHomeCurrentVideoSession(
  now = new Date(),
): WatchHomeCurrentVideoSession | null {
  if (typeof window === "undefined") return null

  try {
    const stored = sessionStorage.getItem(
      WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
    )
    const parsed = safeParseJson<WatchHomeCurrentVideoSession | null>(
      stored,
      null,
    )
    if (!parsed || typeof parsed.videoId !== "string") return null

    const ageMs = now.getTime() - parsed.timestamp
    if (ageMs > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY)
      return null
    }

    return parsed
  } catch {
    try {
      sessionStorage.removeItem(WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY)
    } catch {
      // Ignore storage errors from private browsing or disabled storage.
    }
    return null
  }
}

export function buildWatchHomeVideoQueue({
  existingVideos = [],
  now = new Date(),
  playedIds,
  pools,
  startPoolIndex = 0,
  targetVideoCount,
  useStoredProgress = true,
}: QueueBuildInput): {
  videos: WatchHomeTvCarouselVideoSlide[]
  nextPoolIndex: number
} {
  if (targetVideoCount <= existingVideos.length || pools.length === 0) {
    return { videos: [...existingVideos], nextPoolIndex: startPoolIndex }
  }

  if (existingVideos.length > 0 && existingVideos.length % 50 === 0) {
    resetWatchHomeTvPlayedIds()
  }

  const videos = [...existingVideos]
  const seen = new Set(videos.map((video) => video.id))
  const persistentPlayed = new Set(
    playedIds ?? (useStoredProgress ? readWatchHomeTvPlayedIds(now) : []),
  )
  let poolIndex = Math.max(0, startPoolIndex)
  let attempts = 0
  const maxAttempts = Math.max(pools.length * 4, targetVideoCount * 6)

  while (videos.length < targetVideoCount && attempts < maxAttempts) {
    const pool = pools[poolIndex % pools.length]
    attempts += 1

    if (
      !pool ||
      (useStoredProgress &&
        isWatchHomePoolExhausted(pool.id, pool.videos.length))
    ) {
      poolIndex += 1
      continue
    }

    const poolPlayed = new Set(
      useStoredProgress ? readWatchHomePoolPlayedIds(pool.id) : [],
    )
    const candidates = pool.videos.filter(
      (video) =>
        Boolean(video.src) &&
        !seen.has(video.id) &&
        !persistentPlayed.has(video.id) &&
        !poolPlayed.has(video.id),
    )

    if (candidates.length === 0) {
      if (useStoredProgress) {
        markWatchHomePoolFailure(pool.id, pool.videos.length)
      }
      poolIndex += 1
      continue
    }

    const offset = getWatchHomeDeterministicOffset(pool.id, candidates.length, {
      now,
      poolIndex,
      totalVideosLoaded: videos.length,
    })
    const candidate = candidates[offset]
    if (candidate) {
      const video = {
        ...candidate,
        poolId: pool.id,
        poolIndex,
      }
      videos.push(video)
      seen.add(video.id)
      if (useStoredProgress) {
        resetWatchHomePoolFailures(pool.id)
      }
    }

    poolIndex += 1
  }

  return { videos, nextPoolIndex: poolIndex }
}

function muxStreamUrl(playbackId: string) {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

function muxPosterUrl(playbackId: string, width = 1280) {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=720&fit_mode=smartcrop`
}

function timeRangeMatches(start: number, end: number, hour: number) {
  if (start === end) return true
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

function currentEasternHour(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/New_York",
  }).formatToParts(now)
  const hour = parts.find((part) => part.type === "hour")?.value
  return hour ? Number(hour) : now.getHours()
}

function overlayForInsert(insert: WatchHomeMuxInsertConfig, now: Date) {
  const overlays = insert.conditionalOverlays ?? []
  const hour = currentEasternHour(now)
  const selected = overlays
    .filter((overlay) =>
      overlay.conditions.every((condition) =>
        condition.type === "time-range"
          ? timeRangeMatches(condition.range.start, condition.range.end, hour)
          : false,
      ),
    )
    .sort((a, b) => b.priority - a.priority)[0]

  if (!selected) {
    return {
      copyId: insert.copyId,
      action: insert.action,
    }
  }

  return {
    copyId: selected.copyId,
    action: selected.overlay.action ?? insert.action,
  }
}

function readMuxSelections(): Record<string, string> {
  if (typeof window === "undefined") return {}

  try {
    return safeParseJson<Record<string, string>>(
      sessionStorage.getItem(WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY),
      {},
    )
  } catch {
    return {}
  }
}

function writeMuxSelection(insertId: string, playbackId: string) {
  if (typeof window === "undefined") return

  try {
    const selections = readMuxSelections()
    sessionStorage.setItem(
      WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY,
      JSON.stringify({ ...selections, [insertId]: playbackId }),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

function getMuxSessionSeed(): string | undefined {
  if (typeof window === "undefined") return undefined

  try {
    const existing = sessionStorage.getItem(
      WATCH_HOME_TV_MUX_SELECTIONS_SEED_STORAGE_KEY,
    )
    if (existing) return existing
    const seed =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(WATCH_HOME_TV_MUX_SELECTIONS_SEED_STORAGE_KEY, seed)
    return seed
  } catch {
    return undefined
  }
}

function selectMuxPlaybackId(
  insert: WatchHomeMuxInsertConfig,
  options: { useStoredSelections?: boolean } = {},
): {
  playbackId: string | null
  playbackIndex: number
} {
  const playbackIds = insert.playbackIds.filter(Boolean)
  if (playbackIds.length === 0) return { playbackId: null, playbackIndex: -1 }

  const useStoredSelections = options.useStoredSelections ?? true
  const stored = useStoredSelections ? readMuxSelections()[insert.id] : null
  if (stored && playbackIds.includes(stored)) {
    return { playbackId: stored, playbackIndex: playbackIds.indexOf(stored) }
  }

  const seed = useStoredSelections ? getMuxSessionSeed() : undefined
  const index =
    simpleHash(`${seed ?? "watch-home"}:${insert.id}`) % playbackIds.length
  const playbackId = playbackIds[index]
  if (!playbackId) return { playbackId: null, playbackIndex: -1 }

  if (useStoredSelections) {
    writeMuxSelection(insert.id, playbackId)
  }
  return { playbackId, playbackIndex: index }
}

function muxInsertToSlide(
  insert: WatchHomeMuxInsertConfig,
  options: {
    now: Date
    prefixTitleWithDate?: boolean
    useStoredSelections?: boolean
  },
): WatchHomeTvCarouselMuxSlide | null {
  const { playbackId, playbackIndex } = selectMuxPlaybackId(insert, {
    useStoredSelections: options.useStoredSelections,
  })
  if (!playbackId) return null

  const overlay = overlayForInsert(insert, options.now)
  const posterUrl = insert.posterOverride ?? muxPosterUrl(playbackId)

  return {
    kind: "mux",
    id: `mux-${insert.id}`,
    copyId: overlay.copyId,
    href: null,
    action: overlay.action,
    secondaryAction: overlay.action ? { type: "watch-short-film" } : null,
    posterUrl,
    thumbnailUrl: muxPosterUrl(playbackId, 640),
    src: muxStreamUrl(playbackId),
    playbackId,
    durationSeconds: insert.durationSeconds,
    logo: insert.logo,
    playbackIndex,
    titleDate: options.prefixTitleWithDate ? options.now.toISOString() : null,
  }
}

export function mergeWatchHomeMuxInserts(
  videos: readonly WatchHomeTvCarouselVideoSlide[],
  inserts: readonly WatchHomeMuxInsertConfig[],
  now = new Date(),
  options: { useStoredSelections?: boolean } = {},
): WatchHomeTvCarouselSlide[] {
  const enabled = inserts.filter((insert) => insert.enabled)
  if (enabled.length === 0) return [...videos]

  const sequenceStart = enabled.filter(
    (insert) => insert.trigger.type === "sequence-start",
  )
  const afterCount = enabled.filter(
    (
      insert,
    ): insert is WatchHomeMuxInsertConfig & {
      trigger: { type: "after-count"; count: number }
    } => insert.trigger.type === "after-count",
  )
  const inserted = new Set<string>()
  const slides: WatchHomeTvCarouselSlide[] = []
  const firstStartId = sequenceStart[0]?.id

  for (const insert of sequenceStart) {
    const slide = muxInsertToSlide(insert, {
      now,
      prefixTitleWithDate: insert.id === firstStartId,
      useStoredSelections: options.useStoredSelections,
    })
    if (slide) {
      slides.push(slide)
      inserted.add(insert.id)
    }
  }

  videos.forEach((video, index) => {
    slides.push(video)

    for (const insert of afterCount) {
      if (inserted.has(insert.id)) continue
      if (index + 1 < insert.trigger.count) continue
      const slide = muxInsertToSlide(insert, {
        now,
        useStoredSelections: options.useStoredSelections,
      })
      if (slide) {
        slides.push(slide)
        inserted.add(insert.id)
      }
    }
  })

  return slides
}
