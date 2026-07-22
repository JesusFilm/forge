import type {
  WatchHomeMuxInsertAction,
  WatchHomeMuxInsertConfig,
  WatchHomeMuxInsertCopyId,
} from "@/lib/watch-home-config"
import type {
  WatchHomeProgram,
  WatchHomeProgramBucket,
  WatchHomeProgramPromoItem,
  WatchHomeProgramVideoItem,
} from "@/lib/watch-home-types"

export const WATCH_HOME_TV_ADVANCE_THRESHOLD = 95
export const WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY = "carousel-played-ids"
export const WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY = "carousel-current-video"
export const WATCH_HOME_TV_MUX_SELECTIONS_STORAGE_KEY = "mux-insert-selections"
export const WATCH_HOME_TV_MUX_SELECTIONS_SEED_STORAGE_KEY =
  "mux-insert-selections-seed"
export const WATCH_HOME_PROGRAM_LEDGER_STORAGE_KEY = "watch-home-program-ledger"
export const WATCH_HOME_PROGRAM_LEDGER_VERSION = 1
export const WATCH_HOME_PROGRAM_EXPOSURE_TTL_MS = 31 * 24 * 60 * 60 * 1000

export type WatchHomeTvCarouselVideoSlide = {
  kind: "video"
  id: string
  videoId?: string
  programIdentity?: WatchHomeProgramIdentity
  programIsIntro?: boolean
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

export type WatchHomeTvCarouselPromoSlide = {
  kind: "promo"
  id: string
  programIdentity: WatchHomeProgramIdentity
  programIsIntro: boolean
  title: string
  description: string | null
  label: string | null
  href: null
  primaryAction: WatchHomeProgramPromoItem["primaryAction"]
  secondaryAction: WatchHomeProgramPromoItem["secondaryAction"]
  posterUrl: string | null
  thumbnailUrl: string | null
  src: string | null
  playbackId: string | null
  durationSeconds: number | null
  logo: boolean
}

export type WatchHomeTvCarouselMuxSlide = {
  kind: "mux"
  id: string
  programIdentity?: WatchHomeProgramIdentity
  programIsIntro?: boolean
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
  | WatchHomeTvCarouselPromoSlide

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

export type WatchHomeProgramIdentity = `video:${string}` | `promo:${string}`

export type WatchHomeProgramBucketCycle = {
  cycle: number
  remainingIdentities: WatchHomeProgramIdentity[]
  lastIdentity: WatchHomeProgramIdentity | null
}

export type WatchHomeProgramLedger = {
  version: typeof WATCH_HOME_PROGRAM_LEDGER_VERSION
  month: string
  updatedAt: number
  programFingerprint: string
  exposures: Partial<Record<WatchHomeProgramIdentity, number>>
  bucketCycles: Record<string, WatchHomeProgramBucketCycle>
}

export type WatchHomeProgramEngineState = {
  programFingerprint: string
  entryId: string
  rotationCursor: number
  introPending: boolean
  randomState: number
  drawCount: number
  bucketCycles: Record<string, WatchHomeProgramBucketCycle>
  exposedIdentities: WatchHomeProgramIdentity[]
  accountVideoIds: string[]
  quarantinedIdentities: WatchHomeProgramIdentity[]
}

type WatchHomeProgramVideoSelection = {
  kind: "video"
  identity: `video:${string}`
  sequenceId: string
  itemId: string
  bucketId: string
  isIntro: false
  item: WatchHomeProgramVideoItem
}

type WatchHomeProgramPromoSelection = {
  kind: "promo"
  identity: `promo:${string}`
  sequenceId: string
  itemId: string
  bucketId: string | null
  isIntro: boolean
  item: WatchHomeProgramPromoItem
}

export type WatchHomeProgramSelection =
  | WatchHomeProgramVideoSelection
  | WatchHomeProgramPromoSelection

export type WatchHomeProgramDrawResult = {
  item: WatchHomeProgramSelection | null
  state: WatchHomeProgramEngineState
  fallback: boolean
  scannedSlots: number
}

export type WatchHomeProgramStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>

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

type ProgramItem = WatchHomeProgramVideoItem | WatchHomeProgramPromoItem

let watchHomeProgramMemoryLedger: WatchHomeProgramLedger | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function programIdentity(
  bucket: WatchHomeProgramBucket,
  item: ProgramItem,
): WatchHomeProgramIdentity {
  return bucket.kind === "video"
    ? `video:${(item as WatchHomeProgramVideoItem).videoId}`
    : `promo:${item.id}`
}

function playableProgramItems(bucket: WatchHomeProgramBucket) {
  const seen = new Set<WatchHomeProgramIdentity>()
  const items: Array<{
    identity: WatchHomeProgramIdentity
    item: ProgramItem
  }> = []

  for (const item of bucket.items) {
    if (!item.src) continue
    const identity = programIdentity(bucket, item)
    if (identity === "video:" || identity === "promo:" || seen.has(identity)) {
      continue
    }
    seen.add(identity)
    items.push({ identity, item })
  }

  return items
}

function validProgramIdentities(program: WatchHomeProgram) {
  return new Set(
    program.buckets.flatMap((bucket) =>
      playableProgramItems(bucket).map(({ identity }) => identity),
    ),
  )
}

function validBucketIdentities(program: WatchHomeProgram) {
  return new Map(
    program.buckets.map((bucket) => [
      bucket.id,
      new Set(playableProgramItems(bucket).map(({ identity }) => identity)),
    ]),
  )
}

export function getWatchHomeProgramFingerprint(program: WatchHomeProgram) {
  const shape = {
    buckets: program.buckets.map((bucket) => ({
      id: bucket.id,
      kind: bucket.kind,
      identities: playableProgramItems(bucket).map(({ identity }) => identity),
    })),
    rotation: program.rotation,
  }
  return `whp-${simpleHash(JSON.stringify(shape)).toString(36)}`
}

function normalizeSeed(seed: string | number) {
  const value =
    typeof seed === "number" && Number.isFinite(seed)
      ? Math.trunc(seed) >>> 0
      : simpleHash(String(seed)) >>> 0
  return value || 0x6d2b79f5
}

function nextProgramRandom(randomState: number) {
  const nextState = (randomState + 0x6d2b79f5) >>> 0
  let value = nextState
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return {
    randomState: nextState,
    value: ((value ^ (value >>> 14)) >>> 0) / 4294967296,
  }
}

function shuffleProgramIdentities(
  identities: readonly WatchHomeProgramIdentity[],
  randomState: number,
) {
  const shuffled = [...identities]
  let nextState = randomState
  for (let index = shuffled.length - 1; index > 0; index--) {
    const random = nextProgramRandom(nextState)
    nextState = random.randomState
    const swapIndex = Math.floor(random.value * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]!
    shuffled[swapIndex] = current!
  }
  return { identities: shuffled, randomState: nextState }
}

function cloneBucketCycles(
  cycles: Record<string, WatchHomeProgramBucketCycle>,
) {
  return Object.fromEntries(
    Object.entries(cycles).map(([bucketId, cycle]) => [
      bucketId,
      {
        cycle: cycle.cycle,
        remainingIdentities: [...cycle.remainingIdentities],
        lastIdentity: cycle.lastIdentity,
      },
    ]),
  )
}

export function createWatchHomeProgramEngine(
  program: WatchHomeProgram,
  options: {
    seed?: string | number
    random?: () => number
    ledger?: WatchHomeProgramLedger | null
    exposedIdentities?: readonly WatchHomeProgramIdentity[]
    accountVideoIds?: readonly string[]
  } = {},
): WatchHomeProgramEngineState {
  const programFingerprint = getWatchHomeProgramFingerprint(program)
  const ledger = options.ledger
  const cycles =
    ledger?.programFingerprint === programFingerprint
      ? cloneBucketCycles(ledger.bucketCycles)
      : {}
  const exposed = new Set<WatchHomeProgramIdentity>([
    ...(ledger ? Object.keys(ledger.exposures) : []),
    ...(options.exposedIdentities ?? []),
  ] as WatchHomeProgramIdentity[])
  const seed =
    options.seed ??
    Math.floor((options.random?.() ?? Math.random()) * 0x1_0000_0000)

  return {
    programFingerprint,
    entryId: normalizeSeed(seed).toString(36),
    rotationCursor: 0,
    introPending: program.intro != null,
    randomState: normalizeSeed(seed),
    drawCount: 0,
    bucketCycles: cycles,
    exposedIdentities: [...exposed],
    accountVideoIds: [...new Set(options.accountVideoIds ?? [])],
    quarantinedIdentities: [],
  }
}

function cloneProgramEngineState(
  state: WatchHomeProgramEngineState,
): WatchHomeProgramEngineState {
  return {
    ...state,
    bucketCycles: cloneBucketCycles(state.bucketCycles),
    exposedIdentities: [...state.exposedIdentities],
    accountVideoIds: [...state.accountVideoIds],
    quarantinedIdentities: [...state.quarantinedIdentities],
  }
}

function selectProgramBucketItem(
  bucket: WatchHomeProgramBucket,
  state: WatchHomeProgramEngineState,
) {
  const eligible = playableProgramItems(bucket).filter(
    ({ identity }) => !state.quarantinedIdentities.includes(identity),
  )
  if (eligible.length === 0) return null

  const eligibleIdentities = new Set(eligible.map(({ identity }) => identity))
  const previousCycle = state.bucketCycles[bucket.id]
  let remaining = (previousCycle?.remainingIdentities ?? []).filter(
    (identity) => eligibleIdentities.has(identity),
  )
  const uniqueRemaining = [...new Set(remaining)]
  remaining = uniqueRemaining
  const reset = remaining.length === 0

  if (reset) {
    const shuffled = shuffleProgramIdentities(
      eligible.map(({ identity }) => identity),
      state.randomState,
    )
    state.randomState = shuffled.randomState
    remaining = shuffled.identities
  }

  const lastIdentity = previousCycle?.lastIdentity ?? null
  const accountSeen = new Set(
    state.accountVideoIds.map((videoId) => `video:${videoId}`),
  )
  const locallySeen = new Set(state.exposedIdentities)
  const unseen = (identity: WatchHomeProgramIdentity) =>
    !locallySeen.has(identity) && !accountSeen.has(identity)
  const withoutBoundaryRepeat =
    reset && remaining.length > 1
      ? remaining.filter((identity) => identity !== lastIdentity)
      : remaining
  const preferred = withoutBoundaryRepeat.filter(unseen)
  const selectedIdentity =
    preferred[0] ??
    withoutBoundaryRepeat[0] ??
    remaining.find(unseen) ??
    remaining[0]
  if (!selectedIdentity) return null

  const selected = eligible.find(
    ({ identity }) => identity === selectedIdentity,
  )
  if (!selected) return null

  state.bucketCycles[bucket.id] = {
    cycle: reset
      ? (previousCycle?.cycle ?? 0) + 1
      : (previousCycle?.cycle ?? 1),
    remainingIdentities: remaining.filter(
      (identity) => identity !== selectedIdentity,
    ),
    lastIdentity: selectedIdentity,
  }

  return selected
}

function programSequenceId(
  state: WatchHomeProgramEngineState,
  identity: WatchHomeProgramIdentity,
) {
  return `program-${state.entryId}-${state.drawCount}-${identity}`
}

export function drawNextWatchHomeProgramItem(
  program: WatchHomeProgram,
  currentState: WatchHomeProgramEngineState,
): WatchHomeProgramDrawResult {
  const state = cloneProgramEngineState(currentState)

  if (state.introPending) {
    state.introPending = false
    const intro = program.intro
    if (intro?.src) {
      const identity = `promo:${intro.id}` as const
      const item: WatchHomeProgramPromoSelection = {
        kind: "promo",
        identity,
        sequenceId: programSequenceId(state, identity),
        itemId: intro.id,
        bucketId: null,
        isIntro: true,
        item: intro,
      }
      state.drawCount += 1
      return { item, state, fallback: false, scannedSlots: 0 }
    }
  }

  if (program.rotation.length === 0) {
    return { item: null, state, fallback: true, scannedSlots: 0 }
  }

  for (
    let scannedSlots = 1;
    scannedSlots <= program.rotation.length;
    scannedSlots++
  ) {
    const bucketId =
      program.rotation[state.rotationCursor % program.rotation.length]
    state.rotationCursor += 1
    const bucket = program.buckets.find(
      (candidate) => candidate.id === bucketId,
    )
    if (!bucket) continue

    const selected = selectProgramBucketItem(bucket, state)
    if (!selected) continue

    const sequenceId = programSequenceId(state, selected.identity)
    const item: WatchHomeProgramSelection =
      bucket.kind === "video"
        ? {
            kind: "video",
            identity: selected.identity as `video:${string}`,
            sequenceId,
            itemId: selected.item.id,
            bucketId: bucket.id,
            isIntro: false,
            item: selected.item as WatchHomeProgramVideoItem,
          }
        : {
            kind: "promo",
            identity: selected.identity as `promo:${string}`,
            sequenceId,
            itemId: selected.item.id,
            bucketId: bucket.id,
            isIntro: false,
            item: selected.item as WatchHomeProgramPromoItem,
          }
    state.drawCount += 1
    return { item, state, fallback: false, scannedSlots }
  }

  return {
    item: null,
    state,
    fallback: true,
    scannedSlots: program.rotation.length,
  }
}

export function exposeWatchHomeProgramIdentity(
  currentState: WatchHomeProgramEngineState,
  identity: WatchHomeProgramIdentity,
) {
  if (currentState.exposedIdentities.includes(identity)) return currentState
  return {
    ...cloneProgramEngineState(currentState),
    exposedIdentities: [...currentState.exposedIdentities, identity],
  }
}

export function quarantineWatchHomeProgramIdentity(
  currentState: WatchHomeProgramEngineState,
  identity: WatchHomeProgramIdentity,
) {
  if (currentState.quarantinedIdentities.includes(identity)) return currentState
  return {
    ...cloneProgramEngineState(currentState),
    quarantinedIdentities: [...currentState.quarantinedIdentities, identity],
  }
}

function emptyWatchHomeProgramLedger(
  program: WatchHomeProgram,
  now: Date,
): WatchHomeProgramLedger {
  return {
    version: WATCH_HOME_PROGRAM_LEDGER_VERSION,
    month: currentStorageMonth(now),
    updatedAt: now.getTime(),
    programFingerprint: getWatchHomeProgramFingerprint(program),
    exposures: {},
    bucketCycles: {},
  }
}

function sanitizeWatchHomeProgramLedger(
  value: unknown,
  program: WatchHomeProgram,
  now: Date,
): WatchHomeProgramLedger {
  const empty = emptyWatchHomeProgramLedger(program, now)
  if (!isRecord(value)) return empty
  if (
    value.version !== WATCH_HOME_PROGRAM_LEDGER_VERSION ||
    value.month !== currentStorageMonth(now)
  ) {
    return empty
  }

  const validIdentities = validProgramIdentities(program)
  const exposures: WatchHomeProgramLedger["exposures"] = {}
  if (isRecord(value.exposures)) {
    for (const [identity, timestamp] of Object.entries(value.exposures)) {
      if (
        validIdentities.has(identity as WatchHomeProgramIdentity) &&
        typeof timestamp === "number" &&
        Number.isFinite(timestamp) &&
        timestamp <= now.getTime() + 5 * 60 * 1000 &&
        now.getTime() - timestamp <= WATCH_HOME_PROGRAM_EXPOSURE_TTL_MS
      ) {
        exposures[identity as WatchHomeProgramIdentity] = timestamp
      }
    }
  }

  const currentFingerprint = getWatchHomeProgramFingerprint(program)
  const bucketCycles: Record<string, WatchHomeProgramBucketCycle> = {}
  if (
    value.programFingerprint === currentFingerprint &&
    isRecord(value.bucketCycles)
  ) {
    const validByBucket = validBucketIdentities(program)
    for (const [bucketId, rawCycle] of Object.entries(value.bucketCycles)) {
      const valid = validByBucket.get(bucketId)
      if (!valid || !isRecord(rawCycle)) continue
      const remainingIdentities = Array.isArray(rawCycle.remainingIdentities)
        ? [
            ...new Set(
              rawCycle.remainingIdentities.filter(
                (identity): identity is WatchHomeProgramIdentity =>
                  typeof identity === "string" &&
                  valid.has(identity as WatchHomeProgramIdentity),
              ),
            ),
          ]
        : []
      const lastIdentity =
        typeof rawCycle.lastIdentity === "string" &&
        valid.has(rawCycle.lastIdentity as WatchHomeProgramIdentity)
          ? (rawCycle.lastIdentity as WatchHomeProgramIdentity)
          : null
      const cycle =
        typeof rawCycle.cycle === "number" &&
        Number.isInteger(rawCycle.cycle) &&
        rawCycle.cycle > 0
          ? rawCycle.cycle
          : 1
      bucketCycles[bucketId] = { cycle, remainingIdentities, lastIdentity }
    }
  }

  return {
    ...empty,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : empty.updatedAt,
    exposures,
    bucketCycles,
  }
}

function defaultWatchHomeProgramStorage(): WatchHomeProgramStorage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function migrateLegacyWatchHomePlayedIds(
  storage: WatchHomeProgramStorage,
  program: WatchHomeProgram,
  now: Date,
) {
  let legacy: unknown
  try {
    legacy = JSON.parse(
      storage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY) ?? "null",
    )
  } catch {
    return {}
  }
  if (
    !isRecord(legacy) ||
    legacy.month !== currentStorageMonth(now) ||
    !Array.isArray(legacy.ids)
  ) {
    return {}
  }

  const legacyIds = new Set(
    legacy.ids.filter((id): id is string => typeof id === "string"),
  )
  const exposures: WatchHomeProgramLedger["exposures"] = {}
  for (const bucket of program.buckets) {
    if (bucket.kind !== "video") continue
    for (const item of bucket.items) {
      if (
        legacyIds.has(item.videoId) ||
        legacyIds.has(item.coreId) ||
        legacyIds.has(item.id)
      ) {
        exposures[`video:${item.videoId}`] = now.getTime()
      }
    }
  }
  return exposures
}

export function readWatchHomeProgramLedger(
  program: WatchHomeProgram,
  options: { now?: Date; storage?: WatchHomeProgramStorage | null } = {},
) {
  const now = options.now ?? new Date()
  const storage =
    options.storage === undefined
      ? defaultWatchHomeProgramStorage()
      : options.storage
  if (!storage) {
    if (typeof window === "undefined" && options.storage === undefined) {
      return emptyWatchHomeProgramLedger(program, now)
    }
    return sanitizeWatchHomeProgramLedger(
      watchHomeProgramMemoryLedger,
      program,
      now,
    )
  }

  try {
    const raw = storage.getItem(WATCH_HOME_PROGRAM_LEDGER_STORAGE_KEY)
    if (!raw) {
      const ledger = emptyWatchHomeProgramLedger(program, now)
      ledger.exposures = migrateLegacyWatchHomePlayedIds(storage, program, now)
      return ledger
    }
    return sanitizeWatchHomeProgramLedger(JSON.parse(raw), program, now)
  } catch {
    return sanitizeWatchHomeProgramLedger(
      watchHomeProgramMemoryLedger,
      program,
      now,
    )
  }
}

function mergeWatchHomeProgramCycles(
  stored: Record<string, WatchHomeProgramBucketCycle>,
  incoming: Record<string, WatchHomeProgramBucketCycle>,
) {
  const merged = cloneBucketCycles(stored)
  for (const [bucketId, cycle] of Object.entries(incoming)) {
    const current = merged[bucketId]
    if (!current || cycle.cycle > current.cycle) {
      merged[bucketId] = {
        cycle: cycle.cycle,
        remainingIdentities: [...cycle.remainingIdentities],
        lastIdentity: cycle.lastIdentity,
      }
    } else if (cycle.cycle === current.cycle) {
      merged[bucketId] = {
        cycle: cycle.cycle,
        remainingIdentities: cycle.remainingIdentities.filter((identity) =>
          current.remainingIdentities.includes(identity),
        ),
        lastIdentity: cycle.lastIdentity ?? current.lastIdentity,
      }
    }
  }
  return merged
}

export function persistWatchHomeProgramLedger(
  program: WatchHomeProgram,
  state: WatchHomeProgramEngineState,
  options: { now?: Date; storage?: WatchHomeProgramStorage | null } = {},
) {
  const now = options.now ?? new Date()
  const stored = readWatchHomeProgramLedger(program, options)
  const exposures = { ...stored.exposures }
  for (const identity of state.exposedIdentities) {
    exposures[identity] = Math.max(exposures[identity] ?? 0, now.getTime())
  }
  const sameProgram =
    stored.programFingerprint === state.programFingerprint &&
    state.programFingerprint === getWatchHomeProgramFingerprint(program)
  const ledger: WatchHomeProgramLedger = {
    version: WATCH_HOME_PROGRAM_LEDGER_VERSION,
    month: currentStorageMonth(now),
    updatedAt: now.getTime(),
    programFingerprint: getWatchHomeProgramFingerprint(program),
    exposures,
    bucketCycles: sameProgram
      ? mergeWatchHomeProgramCycles(stored.bucketCycles, state.bucketCycles)
      : {},
  }
  const sanitized = sanitizeWatchHomeProgramLedger(ledger, program, now)
  watchHomeProgramMemoryLedger = sanitized

  const storage =
    options.storage === undefined
      ? defaultWatchHomeProgramStorage()
      : options.storage
  try {
    storage?.setItem(
      WATCH_HOME_PROGRAM_LEDGER_STORAGE_KEY,
      JSON.stringify(sanitized),
    )
  } catch {
    // The in-memory copy keeps this entry working when storage is denied/full.
  }
  return sanitized
}

export function resetWatchHomeProgramLedgerMemory() {
  watchHomeProgramMemoryLedger = null
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
