/**
 * The Explore clip queue host (U22). The harness composes the hook with the
 * REAL feed reducer, as the feed will, over a fake Apollo client, the real
 * clip record on in-memory storage, and a fake timing source and pool store.
 * Jest's modern fake timers drive the clock, the retries, and the budget.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("../../env", () => ({
  env: { EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "http://localhost:3003/api/graphql" },
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
}))
// The hook's defaults import the app client; every case injects its own.
jest.mock("../../lib/apolloClient", () => ({
  getApolloClient: jest.fn(() => {
    throw new Error("a case injects its own client")
  }),
  isUnreachableEndpointError: jest.fn(() => true),
}))
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("expo-image", () => ({ Image: { prefetch: jest.fn() } }))
jest.mock("../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: jest.fn(() => ({ audioLanguageSlug: "swahili" })),
}))

import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  Observable,
} from "@apollo/client"
import {
  StrictMode,
  act,
  createElement,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactElement,
} from "react"
import { AppState } from "react-native"

import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import {
  CLIP_RECORD_STORAGE_KEY,
  createClipRecordStore,
  serializeClipRecord,
} from "../../lib/explore/clipRecord"
import type { ClipTimingResult } from "../../lib/explore/clipTiming"
import type { EligibleStartsMemo, MemoSlot } from "../../lib/explore/clipWindow"
import {
  INITIAL_FEED_STATE,
  currentClip,
  feedReducer,
  needsClip,
  nextClip,
  toFeedClip,
  type FeedEvent,
  type FeedState,
} from "../../lib/explore/feedState"
import type { PlayerMode } from "../../lib/explore/playerMode"
import {
  EXPLORE_INVENTORY_LIMIT,
  projectInventory,
  type ExplorePool,
  type StoredReadyClip,
} from "../../lib/explore/pool"
import { EXPLORE_VISIT_TIMEOUT_MS } from "../../lib/explore/telemetry"
import type { ReadyClip } from "../../lib/explore/types"
import { muxClipStillUrl } from "../../lib/muxThumbnail"
import { EXPLORE_CLIP_CANDIDATES, EXPLORE_INVENTORY } from "../../lib/queries"
import type {
  DeliveryResult,
  UserRecommendationItem,
  UserRecommendationSlate,
} from "../../lib/recommendations/delivery"
import {
  EXPLORE_DELIVERY_ATTEMPTS_PER_HOUR,
  EXPLORE_DELIVERY_SPACING_MS,
  QUEUE_RETRY_DELAYS_MS,
  createExploreDeliveryBudget,
  useExploreClipQueue,
  type ExploreClipQueue,
  type ExploreClipQueueDeps,
  type ExploreDeliveryBudget,
  type PoolFallbackReport,
} from "../useExploreClipQueue"
import {
  DELIVERY_RETRY_DELAY_MS,
  type UserRecommendationsClient,
} from "../useUserRecommendations"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const mockPreferences = useWatchPreferences as unknown as jest.Mock

const SW = "swahili"
const EN = "english"
const T0 = Date.UTC(2026, 8, 25, 10, 0, 0)
const MINUTE = 60_000

// ── Fixtures ────────────────────────────────────────────────────────

function row(id: string, languageSlug: string) {
  return {
    __typename: "WatchLanguageInventoryItem",
    id: `video-${id}`,
    coreId: `core-${id}`,
    slug: `slug-${id}`,
    label: "segment",
    availability: "AUDIO",
    durationSeconds: 300,
    muxPlaybackId: `mux${id}`,
    watchLanguageSlug: languageSlug,
    title: `Title ${id}`,
    description: null,
  }
}

function inventory(ids: readonly string[], languageSlug: string) {
  return {
    __typename: "WatchLanguageInventory",
    language: {
      __typename: "WatchLanguageInventoryLanguage",
      slug: languageSlug,
    },
    audioCollections: [],
    audioVideos: ids.map((id) => row(id, languageSlug)),
    subtitleOnlyVideos: [],
  }
}

function storedPool(
  ids: readonly string[],
  fetchedAt: number,
  languageSlug = SW,
): ExplorePool {
  return projectInventory(
    inventory(ids, languageSlug) as never,
    languageSlug,
    fetchedAt,
  )
}

/** The production hydration shape, trailing `hls` newline included. */
function hydrated(coreId: string, audioSlug: string, tracks: boolean) {
  const id = coreId.replace("core-", "")
  return {
    __typename: "Video",
    documentId: `video-${id}`,
    coreId,
    images: [],
    preferredPlayableDub: {
      __typename: "VideoDub",
      documentId: `dub-${id}`,
      hls: `https://stream.mux.com/stream${id}.m3u8\n`,
      duration: 300,
      lengthInMilliseconds: "300000",
      language: { __typename: "Language", slug: audioSlug },
      muxVideo: { __typename: "MuxVideo", playbackId: `stream${id}` },
      videoEdition: {
        __typename: "VideoEdition",
        documentId: `edition-${id}`,
        subtitles: tracks
          ? [
              {
                __typename: "VideoSubtitle",
                documentId: `sub-${id}`,
                vttSrc: `https://api-media-core.jesusfilm.org/${id}/${audioSlug}.vtt`,
                primary: true,
                aiGenerated: false,
                language: { __typename: "Language", slug: audioSlug },
              },
            ]
          : [],
      },
    },
  }
}

function readyClip(id: string, overrides: Partial<ReadyClip> = {}): ReadyClip {
  return {
    videoId: `video-${id}`,
    coreId: `core-${id}`,
    slug: `slug-${id}`,
    label: "segment",
    availability: "AUDIO",
    durationSeconds: 300,
    muxPlaybackId: `stream${id}`,
    watchLanguageSlug: SW,
    title: `Title ${id}`,
    description: null,
    imageUrl: null,
    feedLanguageSlug: SW,
    streamUrl: `https://stream.mux.com/stream${id}.m3u8`,
    audioLanguageSlug: SW,
    subtitleLanguageSlug: null,
    subtitleVttSrc: null,
    subtitleOnly: false,
    window: { startSeconds: 12, endSeconds: 42 },
    cut: "fallback",
    ...overrides,
  }
}

function slateItem(targetId: string, index: number): UserRecommendationItem {
  return {
    id: `item-${index}`,
    position: index,
    targetMediaId: `video-${targetId}`,
    canonicalHref: `https://www.jesusfilm.org/watch/${targetId}.html`,
    capability: `cap-${index}`,
    videoSlug: `slug-${targetId}`,
    videoTitle: `Title ${targetId}`,
    imageUrl: null,
    description: "",
    durationSeconds: 300,
    generator: "curated",
    poolVersion: null,
    poolKey: null,
  }
}

/** Six distinct targets; ids that are not in the pool are simply skipped. */
function slate(first: readonly string[], requestId = "req-1") {
  const targets = [...first]
  for (let n = 0; targets.length < 6; n++) targets.push(`absent-${n}`)
  const value: UserRecommendationSlate = {
    requestId,
    expiresAt: null,
    cohort: "cold_start",
    profileCount: 0,
    curatedCount: 6,
    poolVersion: null,
    items: targets.map(slateItem),
  }
  return value
}

const SERVED = (first: readonly string[]): DeliveryResult => ({
  kind: "served",
  slate: slate(first),
})

// ── The fake world ──────────────────────────────────────────────────

type QueryOptions = {
  query: unknown
  variables: Record<string, unknown>
  fetchPolicy?: string
}

type AdminOptions = {
  inventories?: Record<string, readonly string[]>
  inventoryFailures?: unknown[]
  hydrationFailures?: unknown[]
  tracks?: boolean
}

function fakeAdmin(options: AdminOptions) {
  const inventoryFailures = [...(options.inventoryFailures ?? [])]
  const hydrationFailures = [...(options.hydrationFailures ?? [])]
  const heldInventory: (() => void)[] = []
  const heldHydrations: (() => void)[] = []
  const admin = {
    holdInventory: false,
    holdHydrations: false,
    inFlight: 0,
    maxInFlight: 0,
    inventoryCalls: [] as {
      languageSlug: unknown
      limit: unknown
      fetchPolicy: unknown
    }[],
    hydrationCalls: [] as {
      coreIds: string[]
      audioLanguageSlug: string
      fetchPolicy: unknown
    }[],
    releaseInventory: () => heldInventory.splice(0).forEach((go) => go()),
    releaseHydrations: () => heldHydrations.splice(0).forEach((go) => go()),
    client: {
      query: jest.fn(async (opts: QueryOptions) => {
        if (opts.query === EXPLORE_INVENTORY) {
          const slug = String(opts.variables.languageSlug)
          admin.inventoryCalls.push({
            languageSlug: slug,
            limit: opts.variables.limit,
            fetchPolicy: opts.fetchPolicy,
          })
          if (admin.holdInventory) {
            await new Promise<void>((go) => heldInventory.push(go))
          }
          const failure = inventoryFailures.shift()
          if (failure) throw failure
          return {
            data: {
              watchLanguageInventory: inventory(
                options.inventories?.[slug] ?? [],
                slug,
              ),
            },
          }
        }
        if (opts.query === EXPLORE_CLIP_CANDIDATES) {
          const coreIds = [...(opts.variables.coreIds as string[])]
          const audio = String(opts.variables.audioLanguageSlug)
          admin.hydrationCalls.push({
            coreIds,
            audioLanguageSlug: audio,
            fetchPolicy: opts.fetchPolicy,
          })
          admin.inFlight += 1
          admin.maxInFlight = Math.max(admin.maxInFlight, admin.inFlight)
          try {
            if (admin.holdHydrations) {
              await new Promise<void>((go) => heldHydrations.push(go))
            }
            const failure = hydrationFailures.shift()
            if (failure) throw failure
            return {
              data: {
                watchHomeVideos: coreIds.map((id) =>
                  hydrated(id, audio, options.tracks ?? false),
                ),
              },
            }
          } finally {
            admin.inFlight -= 1
          }
        }
        throw new Error("unexpected operation")
      }),
    },
  }
  return admin
}

function fakePoolStore(
  pool: ExplorePool | null,
  readyClip: StoredReadyClip | null,
) {
  let heldPool = pool
  let heldClip = readyClip
  return {
    readPool: jest.fn(async (slug: string) =>
      heldPool?.languageSlug === slug ? heldPool : null,
    ),
    writePool: jest.fn(async (next: ExplorePool) => {
      heldPool = next
      return true
    }),
    readReadyClip: jest.fn(async () => heldClip),
    writeReadyClip: jest.fn(async (clip: ReadyClip, storedAt: number) => {
      heldClip = { clip, storedAt }
      return true
    }),
  }
}

function fakeTiming() {
  return {
    hydrate: jest.fn(async () => {}),
    acquire: jest.fn(
      async (): Promise<ClipTimingResult> => ({
        status: "fallback",
        reason: "tracks_failed",
        failures: ["parse_empty"],
      }),
    ),
    resetVisit: jest.fn(),
    setGestureActive: jest.fn(),
    flushNow: jest.fn(async () => {}),
  }
}

function fakeRecommendations(answer: () => Promise<DeliveryResult>) {
  const listeners: (() => void)[] = []
  const client = {
    fetch: jest.fn((_input: unknown) => answer()),
    recordEvidence: jest.fn(async () => "sent"),
    select: jest.fn(async () => {
      throw new Error("Explore must not select")
    }),
    subscribeProfile: jest.fn((listener: () => void) => {
      listeners.push(listener)
      return () => {
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    }),
  }
  return {
    client,
    notifyProfile: () => listeners.slice().forEach((listener) => listener()),
  }
}

const NEVER = () => new Promise<DeliveryResult>(() => {})

type WorldOptions = AdminOptions & {
  storedPool?: ExplorePool | null
  storedClip?: StoredReadyClip | null
  recordEntries?: { videoId: string; start: number; end: number }[]
  deliver?: () => Promise<DeliveryResult>
  budget?: ExploreDeliveryBudget
  client?: ExploreClipQueueDeps["getClient"]
  prefetch?: (uri: string) => Promise<boolean>
}

function world(options: WorldOptions = {}) {
  const admin = fakeAdmin(options)
  const store = fakePoolStore(
    options.storedPool ?? null,
    options.storedClip ?? null,
  )
  const timing = fakeTiming()
  const storage = new Map<string, string>()
  if (options.recordEntries) {
    storage.set(
      CLIP_RECORD_STORAGE_KEY,
      serializeClipRecord(
        {
          entries: options.recordEntries.map((entry) => ({
            videoId: entry.videoId,
            languageSlug: SW,
            startSeconds: entry.start,
            endSeconds: entry.end,
            shownAt: T0 - MINUTE,
          })),
          lastVisitDate: null,
        },
        new Date(T0),
      ),
    )
  }
  const recordGetItem = jest.fn(async (key: string) => storage.get(key) ?? null)
  const record = createClipRecordStore({
    getItem: recordGetItem,
    setItem: async (key, value) => {
      storage.set(key, value)
    },
    now: () => new Date(Date.now()),
  })
  const slots = new Map<string, EligibleStartsMemo>()
  const recs = fakeRecommendations(options.deliver ?? NEVER)
  const prefetch = jest.fn(options.prefetch ?? (async () => true))
  const deps: ExploreClipQueueDeps = {
    getClient: options.client ?? (() => admin.client as never),
    classifyFailure: (error) =>
      error instanceof TypeError ? "unreachable" : "transient",
    poolStore: store,
    record,
    timing: timing as unknown as ExploreClipQueueDeps["timing"],
    eligibleStartsSlot: (vttSrc, videoId): MemoSlot<EligibleStartsMemo> => ({
      get: () => slots.get(`${vttSrc}|${videoId}`),
      set: (value) => {
        slots.set(`${vttSrc}|${videoId}`, value)
      },
    }),
    recommendations: recs.client as unknown as UserRecommendationsClient,
    budget: options.budget ?? createExploreDeliveryBudget(),
    prefetchImage: prefetch,
    random: () => 0,
    now: () => Date.now(),
    deviceLocale: () => "en-US",
  }
  return { deps, admin, store, timing, record, recordGetItem, recs, prefetch }
}

// ── The harness ─────────────────────────────────────────────────────

type HarnessProps = {
  hasFocused: boolean
  focused: boolean
  gestureActive: boolean
  playerMode: PlayerMode
}

type Snapshot = {
  feed: FeedState
  queue: ExploreClipQueue
  dispatch: Dispatch<FeedEvent>
}

type Callbacks = {
  onClip?: (clip: ReadyClip) => void
  onPoolReady?: jest.Mock
  onPoolFallback?: (report: PoolFallbackReport) => void
}

const FOCUSED: HarnessProps = {
  hasFocused: true,
  focused: true,
  gestureActive: false,
  playerMode: "two",
}

const mounted: TestInstance[] = []

function render(
  deps: ExploreClipQueueDeps,
  initial: Partial<HarnessProps> = {},
  options: Callbacks & { strict?: boolean } = {},
) {
  const seen: Snapshot[] = []
  function Harness(props: HarnessProps) {
    const [feed, dispatch] = useReducer(feedReducer, INITIAL_FEED_STATE)
    useEffect(() => {
      if (props.focused) {
        dispatch({ type: "focus", playerMode: props.playerMode })
      } else {
        dispatch({ type: "blur", positionSeconds: null })
      }
    }, [props.focused, props.playerMode])
    const queue = useExploreClipQueue(
      {
        hasFocused: props.hasFocused,
        focused: props.focused,
        gestureActive: props.gestureActive,
        playerMode: feed.playerMode,
        wantsClip: needsClip(feed),
        feedHoldsQueued: feed.queued != null,
        currentClip: currentClip(feed),
        nextClip: nextClip(feed),
        onClip: (clip) => {
          options.onClip?.(clip)
          dispatch({ type: "clipQueued", clip })
        },
        onPoolReady: options.onPoolReady,
        onPoolFallback: options.onPoolFallback,
      },
      deps,
    )
    useEffect(() => {
      if (queue.signal != null) dispatch({ type: queue.signal })
    }, [queue.signal])
    seen.push({ feed, queue, dispatch })
    return null
  }
  const wrap = (props: HarnessProps): ReactElement => {
    const element = createElement(Harness, props)
    return options.strict ? createElement(StrictMode, null, element) : element
  }
  let props: HarnessProps = {
    hasFocused: false,
    focused: false,
    gestureActive: false,
    playerMode: "two",
    ...initial,
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(wrap(props))
  })
  mounted.push(renderer)
  return {
    latest: () => seen[seen.length - 1]!,
    history: () => seen[seen.length - 1]!.feed.history,
    rerender: (next: Partial<HarnessProps>) => {
      props = { ...props, ...next }
      act(() => renderer.update(wrap(props)))
    },
    dispatch: (event: FeedEvent) =>
      act(() => seen[seen.length - 1]!.dispatch(event)),
    unmount: () => act(() => renderer.unmount()),
  }
}

/** Microtasks, then `ms` of fake time, then microtasks again. */
async function flush(ms = 0) {
  await act(async () => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve()
    if (ms > 0) await jest.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 40; i += 1) await Promise.resolve()
  })
}

const ids = (clips: readonly { videoId: string }[]) =>
  clips.map((clip) => clip.videoId)

// jest-expo's AppState.addEventListener is already a mock, so a per-case
// `mockRestore` would strip it for every later case.
const appStateHandlers: ((state: string) => void)[] = []
const appStateSpy = jest.spyOn(AppState, "addEventListener")

function sendAppState(state: string): void {
  act(() => appStateHandlers.slice().forEach((handler) => handler(state)))
}

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  mockPreferences.mockReturnValue({ audioLanguageSlug: SW })
  appStateHandlers.length = 0
  appStateSpy.mockImplementation(((
    _type: string,
    handler: (state: string) => void,
  ) => {
    appStateHandlers.push(handler)
    return {
      remove: () => {
        const at = appStateHandlers.indexOf(handler)
        if (at >= 0) appStateHandlers.splice(at, 1)
      },
    }
  }) as unknown as typeof AppState.addEventListener)
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.useRealTimers()
  jest.clearAllMocks()
})

// ── R46: nothing before the first focus ─────────────────────────────

describe("the first focus (R46, KTD6)", () => {
  it("makes no request, read, or prefetch before the first focus", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const view = render(w.deps)
    await flush(10 * MINUTE)
    // A profile transition before the first focus asks for nothing either.
    act(() => w.recs.notifyProfile())
    await flush(10 * MINUTE)
    expect(w.admin.client.query).not.toHaveBeenCalled()
    expect(w.store.readPool).not.toHaveBeenCalled()
    expect(w.store.readReadyClip).not.toHaveBeenCalled()
    expect(w.recordGetItem).not.toHaveBeenCalled()
    expect(w.timing.hydrate).not.toHaveBeenCalled()
    expect(w.recs.client.fetch).not.toHaveBeenCalled()
    expect(w.prefetch).not.toHaveBeenCalled()

    view.rerender({ hasFocused: true, focused: true })
    await flush()
    // The record, the slate, and the pool start together.
    expect(w.recordGetItem).toHaveBeenCalledTimes(1)
    expect(w.timing.hydrate).toHaveBeenCalledTimes(1)
    expect(w.store.readPool).toHaveBeenCalledWith(SW)
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(1)
    expect(w.admin.inventoryCalls).toEqual([
      {
        languageSlug: SW,
        limit: EXPLORE_INVENTORY_LIMIT,
        fetchPolicy: "no-cache",
      },
    ])
    expect(ids(view.history())).toEqual(["video-a"])
  })

  it("starts each piece once when a first focus lands under StrictMode", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const view = render(w.deps, FOCUSED, { strict: true })
    await flush()
    expect(w.recordGetItem).toHaveBeenCalledTimes(1)
    expect(w.store.readPool).toHaveBeenCalledTimes(1)
    expect(w.admin.inventoryCalls).toHaveLength(1)
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(1)
    expect(w.admin.hydrationCalls).toHaveLength(1)
    expect(ids(view.history())).toEqual(["video-a"])
  })
})

// ── KTD6: the stored pool and the stored ready clip ────────────────

describe("a warm open (KTD6)", () => {
  it("gives the first clip from the stored pool before the slate arrives", async () => {
    const onPoolReady = jest.fn()
    const w = world({ storedPool: storedPool(["a", "b", "c"], T0 - MINUTE) })
    const view = render(w.deps, FOCUSED, { onPoolReady })
    await flush()
    // The slate was asked for and never answered.
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(1)
    // A pool under an hour old needs no fetch.
    expect(w.admin.inventoryCalls).toHaveLength(0)
    expect(ids(view.history())).toEqual(["video-a"])
    expect(onPoolReady.mock.calls).toEqual([["warm"]])
    expect(view.latest().queue.poolState).toBe("warm")
  })

  it("starts from the stored ready clip with no hydration and no subtitle fetch", async () => {
    const stored = readyClip("c")
    const atFirstClip: { hydrations: number; acquisitions: number }[] = []
    const w = world({
      storedPool: storedPool(["a", "b", "c"], T0 - MINUTE),
      storedClip: { clip: stored, storedAt: T0 - 30_000 },
      tracks: true,
    })
    const view = render(w.deps, FOCUSED, {
      onClip: () =>
        atFirstClip.push({
          hydrations: w.admin.hydrationCalls.length,
          acquisitions: w.timing.acquire.mock.calls.length,
        }),
    })
    await flush()
    expect(view.history()[0]).toEqual(toFeedClip(stored))
    expect(atFirstClip[0]).toEqual({ hydrations: 0, acquisitions: 0 })
  })

  it.each([
    [
      "older than the pool",
      { storedAt: T0 - 2 * MINUTE },
      readyClip("c"),
      undefined,
    ],
    [
      "already in the record",
      { storedAt: T0 - 30_000 },
      readyClip("c"),
      [{ videoId: "video-c", start: 12, end: 42 }],
    ],
    [
      "in another feed language",
      { storedAt: T0 - 30_000 },
      readyClip("c", { feedLanguageSlug: EN }),
      undefined,
    ],
  ])(
    "drops a stored clip %s and computes a new one",
    async (_case, stamp, clip, recordEntries) => {
      const w = world({
        storedPool: storedPool(["a", "b", "c"], T0 - MINUTE),
        storedClip: { clip, storedAt: stamp.storedAt },
        recordEntries,
      })
      const atFirstClip: number[] = []
      const view = render(w.deps, FOCUSED, {
        onClip: () => atFirstClip.push(w.admin.hydrationCalls.length),
      })
      await flush()
      expect(ids(view.history())).toEqual(["video-a"])
      expect(atFirstClip[0]).toBe(1)
    },
  )

  it("stores the next ready clip beside the pool", async () => {
    const w = world({ storedPool: storedPool(["a", "b", "c"], T0 - MINUTE) })
    const view = render(w.deps, FOCUSED)
    await flush()
    // a is current, b waits in the feed, c is the queue's next clip.
    expect(ids(view.history())).toEqual(["video-a"])
    expect(view.latest().feed.queued?.videoId).toBe("video-b")
    const [clip, storedAt] = w.store.writeReadyClip.mock.calls.at(-1)!
    expect(clip.videoId).toBe("video-c")
    expect(storedAt).toBe(Date.now())
  })
})

describe("a cold open (KTD6)", () => {
  it("fetches the inventory once without the cache, stores the pool, and reports a cold pool", async () => {
    const onPoolReady = jest.fn()
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const view = render(w.deps, FOCUSED, { onPoolReady })
    await flush()
    expect(w.admin.inventoryCalls).toEqual([
      {
        languageSlug: SW,
        limit: EXPLORE_INVENTORY_LIMIT,
        fetchPolicy: "no-cache",
      },
    ])
    expect(w.store.writePool).toHaveBeenCalledTimes(1)
    expect(w.store.writePool.mock.calls[0][0].languageSlug).toBe(SW)
    expect(onPoolReady.mock.calls).toEqual([["cold"]])
    expect(w.admin.hydrationCalls[0]).toEqual({
      coreIds: ["core-a", "core-b", "core-c"],
      audioLanguageSlug: SW,
      fetchPolicy: "no-cache",
    })
    expect(ids(view.history())).toEqual(["video-a"])
  })

  it("leaves no pool or hydration entry in the shared Apollo cache", async () => {
    const cache = new InMemoryCache()
    const link = new ApolloLink(
      (operation) =>
        new Observable((observer) => {
          const vars = operation.variables as Record<string, unknown>
          const data =
            operation.operationName === "ExploreInventory"
              ? {
                  watchLanguageInventory: inventory(
                    ["a", "b", "c"],
                    String(vars.languageSlug),
                  ),
                }
              : {
                  watchHomeVideos: (vars.coreIds as string[]).map((id) =>
                    hydrated(id, String(vars.audioLanguageSlug), false),
                  ),
                }
          observer.next({ data })
          observer.complete()
        }),
    )
    const client = new ApolloClient({ cache, link })
    const w = world({ client: () => client })
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(ids(view.history())).toEqual(["video-a"])
    const held = JSON.stringify(cache.extract())
    expect(held).not.toMatch(/watchHomeVideos|watchLanguageInventory|Video:/)
  })
})

// ── KTD8: Explore's own slate ──────────────────────────────────────

describe("Explore's recommendations (R25, KTD8)", () => {
  it("asks for six in the feed language and puts a recommended video first", async () => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c", "d", "e", "f"] },
      deliver: async () => SERVED(["e"]),
    })
    w.admin.holdInventory = true
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(w.recs.client.fetch.mock.calls).toEqual([
      [{ locale: "en", audioLanguageSlug: SW, count: 6, attempt: 1 }],
    ])
    w.admin.releaseInventory()
    await flush()
    expect(ids(view.history())).toEqual(["video-e"])
    // Those facts name Home's shelf.
    expect(w.recs.client.recordEvidence).not.toHaveBeenCalled()
    expect(w.recs.client.select).not.toHaveBeenCalled()
  })

  it.each<[string, DeliveryResult]>([
    [
      "refused",
      { kind: "unavailable", reason: "session_hour", retryable: false },
    ],
    [
      "invalid",
      { kind: "unavailable", reason: "invalid_delivery", retryable: false },
    ],
    ["disabled", { kind: "disabled" }],
  ])("a %s delivery leaves random fill only", async (_case, answer) => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c", "d", "e", "f"] },
      deliver: async () => answer,
    })
    w.admin.holdInventory = true
    const view = render(w.deps, FOCUSED)
    await flush()
    w.admin.releaseInventory()
    await flush()
    expect(ids(view.history())).toEqual(["video-a"])
    expect(view.latest().feed.queued?.videoId).toBe("video-b")
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(1)
  })

  it("suppresses a second delivery attempt inside 10 min, across a remount too", async () => {
    const budget = createExploreDeliveryBudget()
    const first = world({
      inventories: { [SW]: ["a", "b", "c"] },
      deliver: async () => SERVED(["a"]),
      budget,
    })
    const view = render(first.deps, FOCUSED)
    await flush()
    expect(first.recs.client.fetch).toHaveBeenCalledTimes(1)
    view.unmount()
    await flush(2 * MINUTE)

    const second = world({
      inventories: { [SW]: ["a", "b", "c"] },
      deliver: async () => SERVED(["a"]),
      budget,
    })
    render(second.deps, FOCUSED)
    await flush()
    expect(second.recs.client.fetch).not.toHaveBeenCalled()
    await flush(EXPLORE_DELIVERY_SPACING_MS - 2 * MINUTE - 1)
    expect(second.recs.client.fetch).not.toHaveBeenCalled()
    await flush(1)
    expect(second.recs.client.fetch).toHaveBeenCalledTimes(1)
  })

  it("keeps a transient failure and its retries under four attempts, and the hour at four", async () => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c"] },
      deliver: async () => ({
        kind: "unavailable",
        reason: "cooldown",
        retryable: true,
      }),
    })
    render(w.deps, FOCUSED)
    await flush()
    await flush(DELIVERY_RETRY_DELAY_MS)
    await flush(DELIVERY_RETRY_DELAY_MS)
    await flush(DELIVERY_RETRY_DELAY_MS)
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(3)

    // A profile change inside the spacing waits for its mark.
    act(() => w.recs.notifyProfile())
    await flush(EXPLORE_DELIVERY_SPACING_MS - 30_000)
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(3)
    await flush(30_000)
    await flush(DELIVERY_RETRY_DELAY_MS)
    await flush(DELIVERY_RETRY_DELAY_MS)
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(
      EXPLORE_DELIVERY_ATTEMPTS_PER_HOUR,
    )

    // The hour is spent: later triggers in it send nothing.
    for (let minute = 12; minute < 60; minute += 12) {
      act(() => w.recs.notifyProfile())
      await flush(12 * MINUTE)
    }
    expect(w.recs.client.fetch).toHaveBeenCalledTimes(
      EXPLORE_DELIVERY_ATTEMPTS_PER_HOUR,
    )
  })
})

// ── R24: a language change ─────────────────────────────────────────

describe("a language change (R24)", () => {
  function languageWorld() {
    return world({
      inventories: { [SW]: ["a", "b", "c"], [EN]: ["x", "y", "z"] },
      deliver: async () => SERVED([]),
    })
  }

  it("sends one pool fetch and one slate request, and keeps the clips already loaded", async () => {
    const w = languageWorld()
    const view = render(w.deps, FOCUSED)
    await flush(EXPLORE_DELIVERY_SPACING_MS)
    const shown = view.history()[0]
    const queued = view.latest().feed.queued
    w.admin.inventoryCalls.length = 0
    w.recs.client.fetch.mockClear()

    mockPreferences.mockReturnValue({ audioLanguageSlug: EN })
    view.rerender({})
    await flush()
    expect(w.admin.inventoryCalls).toEqual([
      {
        languageSlug: EN,
        limit: EXPLORE_INVENTORY_LIMIT,
        fetchPolicy: "no-cache",
      },
    ])
    expect(w.recs.client.fetch.mock.calls).toEqual([
      [{ locale: "en", audioLanguageSlug: EN, count: 6, attempt: 1 }],
    ])
    expect(view.history()[0]).toBe(shown)
    expect(view.latest().feed.queued).toBe(queued)
    expect(view.latest().queue.feedLanguageSlug).toBe(EN)

    view.dispatch({ type: "swipeNext" })
    await flush()
    expect(view.latest().feed.queued?.feedLanguageSlug).toBe(EN)
  })

  it("holds the slate request of an early change until the spacing mark", async () => {
    const w = languageWorld()
    const view = render(w.deps, FOCUSED)
    await flush(MINUTE)
    w.admin.inventoryCalls.length = 0
    w.recs.client.fetch.mockClear()

    mockPreferences.mockReturnValue({ audioLanguageSlug: EN })
    view.rerender({})
    await flush()
    expect(w.admin.inventoryCalls).toHaveLength(1)
    expect(w.recs.client.fetch).not.toHaveBeenCalled()
    await flush(EXPLORE_DELIVERY_SPACING_MS - MINUTE)
    expect(w.recs.client.fetch.mock.calls).toEqual([
      [{ locale: "en", audioLanguageSlug: EN, count: 6, attempt: 1 }],
    ])
  })
})

// ── KTD6: hydration ─────────────────────────────────────────────────

describe("hydration (KTD6)", () => {
  it("keeps one hydration request in flight under StrictMode", async () => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] },
    })
    w.admin.holdHydrations = true
    const view = render(w.deps, FOCUSED, { strict: true })
    for (let round = 0; round < 4; round += 1) {
      await flush()
      w.admin.releaseHydrations()
      await flush()
      view.dispatch({ type: "swipeNext" })
      view.dispatch({ type: "rest" })
    }
    await flush()
    expect(w.admin.hydrationCalls.length).toBeGreaterThanOrEqual(2)
    expect(w.admin.maxInFlight).toBe(1)
  })

  it("holds the new language's first hydration until the old one settles", async () => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c"], [EN]: ["x", "y", "z"] },
    })
    w.admin.holdHydrations = true
    const view = render(w.deps, FOCUSED, { strict: true })
    await flush()
    expect(w.admin.hydrationCalls).toHaveLength(1)

    mockPreferences.mockReturnValue({ audioLanguageSlug: EN })
    view.rerender({})
    await flush()
    // The English pool is in, but the Swahili request is still out.
    expect(w.admin.inventoryCalls.at(-1)?.languageSlug).toBe(EN)
    expect(w.admin.hydrationCalls).toHaveLength(1)

    w.admin.releaseHydrations()
    await flush()
    expect(
      w.admin.hydrationCalls.map((call) => call.audioLanguageSlug),
    ).toEqual([SW, EN])
    w.admin.releaseHydrations()
    await flush()
    expect(w.admin.maxInFlight).toBe(1)
    // The stale Swahili answer made no clip; the first clip is English.
    expect(ids(view.history())).toEqual(["video-x"])
  })

  it("hydrates a video again once its clip has left the queue and the current slot", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(w.admin.hydrationCalls.map((call) => call.coreIds)).toEqual([
      ["core-a", "core-b", "core-c"],
    ])
    expect(ids(view.history())).toEqual(["video-a"])
    expect(view.latest().feed.queued?.videoId).toBe("video-b")

    // a leaves the current slot; nothing in the queue holds it.
    view.dispatch({ type: "swipeNext" })
    await flush()
    expect(w.admin.hydrationCalls.map((call) => call.coreIds)).toEqual([
      ["core-a", "core-b", "core-c"],
      ["core-a"],
    ])
  })
})

// ── R37 / R47: the signals and the retries ──────────────────────────

describe("the offline and empty signals", () => {
  it("gives the offline signal, waits for the viewer, and fetches again on retry", async () => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c"] },
      inventoryFailures: [new TypeError("Network request failed")],
    })
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(view.latest().queue.signal).toBe("offline")
    expect(view.latest().feed.phase).toBe("offline")
    await flush(5 * MINUTE)
    expect(w.admin.inventoryCalls).toHaveLength(1)

    act(() => {
      view.latest().dispatch({ type: "retry" })
      view.latest().queue.retry()
    })
    await flush()
    expect(w.admin.inventoryCalls).toHaveLength(2)
    expect(view.latest().queue.signal).toBeNull()
    expect(ids(view.history())).toEqual(["video-a"])
  })

  it("gives the empty signal for an empty pool", async () => {
    const w = world({ inventories: { [SW]: [] } })
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(view.latest().queue.signal).toBe("empty")
    expect(view.latest().feed.phase).toBe("empty")
  })

  it("retries a transient hydration failure after a backoff, with no signal", async () => {
    const w = world({
      inventories: { [SW]: ["a", "b", "c"] },
      hydrationFailures: [new Error("503")],
    })
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(view.latest().queue.signal).toBeNull()
    expect(view.latest().feed.phase).toBe("preparing")
    expect(w.admin.hydrationCalls).toHaveLength(1)
    await flush(QUEUE_RETRY_DELAYS_MS[0])
    expect(w.admin.hydrationCalls).toHaveLength(2)
    expect(ids(view.history())).toEqual(["video-a"])
  })
})

// ── KTD22: the gesture latch and the background flush ─────────────

describe("the gesture latch (KTD22)", () => {
  it("runs no queue step while the latch is set, and forwards it to both stores", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const recordGesture = jest.spyOn(w.record, "setGestureActive")
    w.admin.holdHydrations = true
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(w.admin.hydrationCalls).toHaveLength(1)

    view.rerender({ gestureActive: true })
    expect(w.timing.setGestureActive).toHaveBeenLastCalledWith(true)
    expect(recordGesture).toHaveBeenLastCalledWith(true)
    w.admin.holdHydrations = false
    w.admin.releaseHydrations()
    await flush(MINUTE)
    // The result landed, but no window search or cut ran.
    expect(view.history()).toHaveLength(0)
    expect(w.store.writeReadyClip).not.toHaveBeenCalled()

    view.rerender({ gestureActive: false })
    await flush()
    expect(w.timing.setGestureActive).toHaveBeenLastCalledWith(false)
    expect(recordGesture).toHaveBeenLastCalledWith(false)
    expect(ids(view.history())).toEqual(["video-a"])
    expect(view.latest().feed.queued?.videoId).toBe("video-b")
    expect(w.admin.hydrationCalls).toHaveLength(1)

    // A swipe re-runs the pump during the gesture. The feed takes the clip
    // that is ready, but the queue computes nothing new until the release.
    view.rerender({ gestureActive: true })
    view.dispatch({ type: "swipeNext" })
    await flush(MINUTE)
    expect(view.latest().feed.queued?.videoId).toBe("video-c")
    expect(w.admin.hydrationCalls).toHaveLength(1)
    view.rerender({ gestureActive: false })
    await flush()
    expect(w.admin.hydrationCalls).toHaveLength(2)
  })

  it("flushes the record and the timing verdicts when the app goes to the background", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const recordFlush = jest.spyOn(w.record, "flushNow")
    render(w.deps, FOCUSED)
    await flush()
    sendAppState("inactive")
    expect(recordFlush).not.toHaveBeenCalled()
    sendAppState("background")
    expect(recordFlush).toHaveBeenCalledTimes(1)
    expect(w.timing.flushNow).toHaveBeenCalledTimes(1)
  })

  it("starts a new probe visit after 30 min away, not after a short blur", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const view = render(w.deps, FOCUSED)
    await flush()
    view.rerender({ focused: false })
    await flush(5 * MINUTE)
    view.rerender({ focused: true })
    await flush()
    expect(w.timing.resetVisit).not.toHaveBeenCalled()
    view.rerender({ focused: false })
    await flush(EXPLORE_VISIT_TIMEOUT_MS)
    view.rerender({ focused: true })
    await flush()
    expect(w.timing.resetVisit).toHaveBeenCalledTimes(1)
  })
})

// ── KTD21: stills, one-player mode only ────────────────────────────

describe("the clip stills (KTD21)", () => {
  it("prefetches the next still in one-player mode and reports the current one once loaded", async () => {
    const loads: ((ok: boolean) => void)[] = []
    const w = world({
      inventories: { [SW]: ["a", "b", "c"] },
      prefetch: () => new Promise<boolean>((done) => loads.push(done)),
    })
    const view = render(w.deps, { ...FOCUSED, playerMode: "one" })
    await flush()
    const current = view.history()[0]
    const queued = view.latest().feed.queued!
    const currentStill = muxClipStillUrl(
      current.muxPlaybackId,
      current.window.startSeconds,
    )
    const queuedStill = muxClipStillUrl(
      queued.muxPlaybackId,
      queued.window.startSeconds,
    )
    expect(w.prefetch.mock.calls.map(([uri]) => uri)).toEqual([
      currentStill,
      queuedStill,
    ])
    expect(view.latest().queue.stillUri).toBe(currentStill)
    expect(view.latest().queue.stillLoaded).toBe(false)

    act(() => loads.forEach((done) => done(true)))
    await flush()
    expect(view.latest().queue.stillLoaded).toBe(true)
  })

  it("prefetches no still in two-player mode", async () => {
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    const view = render(w.deps, FOCUSED)
    await flush()
    expect(view.latest().feed.queued).not.toBeNull()
    expect(w.prefetch).not.toHaveBeenCalled()
    expect(view.latest().queue.stillUri).toBeNull()
  })
})

describe("telemetry callbacks", () => {
  it("reports a clip from a lower tier through onPoolFallback", async () => {
    const reports: PoolFallbackReport[] = []
    const w = world({ inventories: { [SW]: ["a", "b", "c"] } })
    render(w.deps, FOCUSED, {
      onPoolFallback: (report) => reports.push(report),
    })
    await flush()
    expect(reports[0]).toEqual({
      tier: "fallbackDubbed",
      feedLanguageSlug: SW,
      releasedEntries: 0,
    })
  })
})

// ── KTD8: the budget wrapper on its own ─────────────────────────────

describe("the delivery budget (KTD8)", () => {
  const input = (attempt: number) => ({
    locale: "en",
    audioLanguageSlug: SW,
    count: 6,
    attempt,
  })

  function wrapped(answer: () => Promise<DeliveryResult>) {
    const budget = createExploreDeliveryBudget()
    const recs = fakeRecommendations(answer)
    const client = budget.wrap(
      recs.client as unknown as UserRecommendationsClient,
      { now: () => Date.now(), onProfileChange: () => {} },
    )
    return { budget, recs, client }
  }

  const OVER = {
    kind: "unavailable",
    reason: "explore_budget",
    retryable: false,
  }

  it("refuses a new request inside the spacing without sending it", async () => {
    // Synthetic: the hook's scheduler asks `admit` first, so no hook path
    // reaches this backstop in `wrap` today.
    const { recs, client } = wrapped(async () => SERVED(["a"]))
    await client.fetch(input(1))
    jest.setSystemTime(T0 + EXPLORE_DELIVERY_SPACING_MS - 1)
    await expect(client.fetch(input(1))).resolves.toEqual(OVER)
    expect(recs.client.fetch).toHaveBeenCalledTimes(1)
    jest.setSystemTime(T0 + EXPLORE_DELIVERY_SPACING_MS)
    await client.fetch(input(1))
    expect(recs.client.fetch).toHaveBeenCalledTimes(2)
  })

  it("shares the answer in flight with a repeat of the same request", async () => {
    let answer!: (result: DeliveryResult) => void
    const { recs, client } = wrapped(
      () =>
        new Promise<DeliveryResult>((done) => {
          answer = done
        }),
    )
    const first = client.fetch(input(1))
    const repeat = client.fetch(input(1))
    expect(recs.client.fetch).toHaveBeenCalledTimes(1)
    answer(SERVED(["a"]))
    await expect(repeat).resolves.toBe(await first)
  })

  it("counts retries toward the hour and refuses the attempt after four", async () => {
    const { budget, recs, client } = wrapped(async () => ({
      kind: "unavailable",
      reason: "cooldown",
      retryable: true,
    }))
    await client.fetch(input(1))
    await client.fetch(input(2))
    await client.fetch(input(3))
    jest.setSystemTime(T0 + EXPLORE_DELIVERY_SPACING_MS)
    await client.fetch(input(1))
    await expect(client.fetch(input(2))).resolves.toEqual(OVER)
    expect(recs.client.fetch).toHaveBeenCalledTimes(4)
    expect(budget.admit(Date.now())).toEqual({ kind: "never" })
    jest.setSystemTime(T0 + 60 * MINUTE)
    expect(budget.admit(Date.now())).toEqual({ kind: "now" })
  })

  it("sends no evidence and no selection through the base client", async () => {
    const { recs, client } = wrapped(async () => SERVED(["a"]))
    const served = slate(["a"])
    await client.recordEvidence(
      "render",
      served,
      served.items[0],
      null as never,
    )
    await expect(client.select(served, served.items[0])).rejects.toThrow()
    expect(recs.client.recordEvidence).not.toHaveBeenCalled()
    expect(recs.client.select).not.toHaveBeenCalled()
  })
})
