/**
 * feat-517 KTD3: Home hosts the slate hook, so the shelf's first mount is the
 * only fetch trigger, a closed gate stops the slate and its expiry timer, and
 * a blurred Home holds every refresh until focus returns. The client is
 * injected, so no Apollo, no viewer store and no native module take part.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
jest.mock("../../env", () => ({
  env: { EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "http://localhost:3003/api/graphql" },
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: jest.fn(() => ({ audioLanguageSlug: null })),
}))

import { StrictMode, act, createElement } from "react"
import type React from "react"
import { AppState } from "react-native"

import {
  useHomeRecommendations,
  type HomeRecommendationsController,
  type UseHomeRecommendationsOptions,
} from "../useHomeRecommendations"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import type { UserRecommendationsClient } from "../useUserRecommendations"
import type {
  DeliveryResult,
  UserRecommendationItem,
  UserRecommendationSlate,
} from "../../lib/recommendations/delivery"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const mockPreferences = useWatchPreferences as unknown as jest.Mock

function item(index: number): UserRecommendationItem {
  return {
    id: `item-${index}`,
    position: index,
    targetMediaId: `media-${index}`,
    canonicalHref: `https://www.jesusfilm.org/watch/video-${index}.html`,
    capability: `cap-${index}`,
    videoSlug: `video-${index}`,
    videoTitle: `Video ${index}`,
    imageUrl: null,
    description: "",
    durationSeconds: 120,
    generator: "curated",
    poolVersion: null,
    poolKey: null,
  }
}

function slate(
  requestId: string,
  expiresAt: string | null = null,
): UserRecommendationSlate {
  return {
    requestId,
    expiresAt,
    cohort: "cold_start",
    profileCount: 0,
    curatedCount: 6,
    poolVersion: null,
    items: Array.from({ length: 6 }, (_, index) => item(index)),
  }
}

type TestClient = UserRecommendationsClient & {
  fetch: jest.Mock
  recordEvidence: jest.Mock
  select: jest.Mock
}

function client(
  overrides: Partial<UserRecommendationsClient> = {},
): TestClient {
  let served = 0
  return {
    fetch: jest.fn(async () => {
      served += 1
      return { kind: "served", slate: slate(`req-${served}`) } as DeliveryResult
    }),
    recordEvidence: jest.fn(async () => "sent"),
    select: jest.fn(async (_slate, entry: UserRecommendationItem) => ({
      videoSlug: entry.videoSlug,
      targetMediaId: entry.targetMediaId,
      claimNonce: "n".repeat(32),
      acknowledged: true,
    })),
    ...overrides,
  } as TestClient
}

const mounted: TestInstance[] = []

/**
 * `strict` defaults to FALSE, unlike the repo's other hook harnesses: most
 * cases here count `client.fetch` calls, and StrictMode's setup → cleanup →
 * setup cycle doubles the effects that drive them. The remount-safety case
 * opts in, and it is the only deterministic detector of that hazard.
 */
function renderController(
  initial: UseHomeRecommendationsOptions,
  useClient: UserRecommendationsClient,
  options: { strict?: boolean } = {},
) {
  const seen: HomeRecommendationsController[] = []
  function Harness(props: UseHomeRecommendationsOptions) {
    seen.push(useHomeRecommendations(props, useClient))
    return null
  }
  const wrap = (props: UseHomeRecommendationsOptions) => {
    const element = createElement(
      Harness,
      props,
    ) as unknown as React.ReactElement
    return (
      options.strict === true
        ? createElement(StrictMode, null, element)
        : element
    ) as React.ReactElement
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(wrap(initial))
  })
  mounted.push(renderer)
  return {
    latest: () => seen[seen.length - 1]!,
    rerender: (next: UseHomeRecommendationsOptions) =>
      act(() => {
        renderer.update(wrap(next))
      }),
    unmount: () => act(() => renderer.unmount()),
  }
}

// ── The app-state seam ──────────────────────────────────────────────────────

type AppStateHandler = (state: string) => void

const appStateHandlers: AppStateHandler[] = []
const appStateSpy = jest.spyOn(AppState, "addEventListener")

function sendAppState(state: string): void {
  act(() => {
    appStateHandlers.forEach((handler) => handler(state))
  })
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

const OPEN: UseHomeRecommendationsOptions = { gateOpen: true, focused: true }

beforeEach(() => {
  mockPreferences.mockReturnValue({ audioLanguageSlug: null })
  appStateHandlers.length = 0
  appStateSpy.mockImplementation(((_type: string, handler: AppStateHandler) => {
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

describe("the deferred first fetch", () => {
  it("sends nothing until the shelf reports its first mount (R7)", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    await flush()
    expect(c.fetch).not.toHaveBeenCalled()

    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)
    expect(hook.latest().status).toBe("served")
  })

  it("requests the UI locale and the stored audio preference (R5)", async () => {
    mockPreferences.mockReturnValue({ audioLanguageSlug: "french" })
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(c.fetch).toHaveBeenCalledWith({
      locale: "en",
      audioLanguageSlug: "french",
      count: 6,
      attempt: 1,
    })
  })

  it("stays idle while the gate is closed, then fetches when it opens (AE9)", async () => {
    const c = client()
    const hook = renderController({ gateOpen: false, focused: true }, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(c.fetch).not.toHaveBeenCalled()
    expect(hook.latest().status).toBe("idle")

    hook.rerender(OPEN)
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)
  })

  it("latches a first mount reported while Home was blurred", async () => {
    const c = client()
    const hook = renderController({ gateOpen: true, focused: false }, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(c.fetch).not.toHaveBeenCalled()

    hook.rerender(OPEN)
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)
  })
})

describe("the gate closing later", () => {
  it("drops the displayed slate and sends nothing more", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(hook.latest().slate?.requestId).toBe("req-1")

    hook.rerender({ gateOpen: false, focused: true })
    await flush()
    expect(hook.latest().slate).toBeNull()
    expect(hook.latest().status).toBe("idle")

    act(() => hook.latest().refresh())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)
  })
})

describe("the displayed slate", () => {
  it("stays on the last served slate during a refetch (R18, KTD6)", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(hook.latest().slate?.requestId).toBe("req-1")

    act(() => hook.latest().refresh())
    // The inner hook clears its own slate at the start of every refetch; the
    // controller is what keeps the cards on screen until the next one lands.
    expect(hook.latest().status).toBe("loading")
    expect(hook.latest().slate?.requestId).toBe("req-1")

    await flush()
    expect(hook.latest().slate?.requestId).toBe("req-2")
  })

  it("passes evidence and selection through for the served slate", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()

    act(() => hook.latest().recordRender("item-0"))
    act(() => hook.latest().recordImpression("item-1"))
    await act(async () => {
      await hook.latest().select("item-2")
    })
    expect(c.recordEvidence).toHaveBeenCalledTimes(2)
    expect(c.select).toHaveBeenCalledTimes(1)
    expect(c.select.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ id: "item-2" }),
    )
  })
})

describe("the expiry timer", () => {
  const EXPIRY_MS = 60_000

  async function servedWithExpiry(c: TestClient) {
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    return hook
  }

  function expiringClient(): TestClient {
    let served = 0
    return client({
      fetch: jest.fn(async () => {
        served += 1
        return {
          kind: "served",
          slate: slate(
            `req-${served}`,
            new Date(Date.now() + EXPIRY_MS).toISOString(),
          ),
        } as DeliveryResult
      }),
    })
  }

  it("refreshes once when the displayed slate expires (R16)", async () => {
    jest.useFakeTimers()
    const c = expiringClient()
    const hook = await servedWithExpiry(c)
    expect(c.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(EXPIRY_MS)
    })
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
    expect(hook.latest().slate?.requestId).toBe("req-2")
  })

  it("clears the timer on unmount", async () => {
    jest.useFakeTimers()
    const c = expiringClient()
    const hook = await servedWithExpiry(c)
    hook.unmount()

    await act(async () => {
      jest.advanceTimersByTime(EXPIRY_MS * 4)
    })
    expect(c.fetch).toHaveBeenCalledTimes(1)
  })

  // This pins the END-TO-END rule: a closed gate sends nothing. It does NOT
  // discriminate the timer effect's own `enabled` guard, which stays a second
  // bound behind the display-slate clear that already nulls `expiresAt`.
  it("sends no request after the gate drops", async () => {
    jest.useFakeTimers()
    const c = expiringClient()
    const hook = await servedWithExpiry(c)
    hook.rerender({ gateOpen: false, focused: true })

    await act(async () => {
      jest.advanceTimersByTime(EXPIRY_MS * 4)
    })
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)
  })

  it("holds the expiry refresh while Home is blurred", async () => {
    jest.useFakeTimers()
    const c = expiringClient()
    const hook = await servedWithExpiry(c)
    hook.rerender({ gateOpen: true, focused: false })

    await act(async () => {
      jest.advanceTimersByTime(EXPIRY_MS)
    })
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)

    hook.rerender(OPEN)
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
  })
})

describe("the blurred-Home hold (KTD3)", () => {
  it("runs exactly one refetch for several held triggers", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)

    hook.rerender({ gateOpen: true, focused: false })
    act(() => {
      hook.latest().refresh()
      hook.latest().refresh()
      hook.latest().refresh()
    })
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)

    hook.rerender(OPEN)
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
  })

  it("holds a profile transition that lands while Home is blurred", async () => {
    let notify = () => {}
    const c = client({
      subscribeProfile: (listener) => {
        notify = listener
        return () => {}
      },
    })
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)

    hook.rerender({ gateOpen: true, focused: false })
    act(() => notify())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)

    hook.rerender(OPEN)
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
  })

  it("runs a refresh straight away while Home is focused", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()

    act(() => hook.latest().refresh())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
  })
})

// ── The impression dwell (KTD4) ─────────────────────────────────────────────

describe("the impression dwell (R12, KTD4)", () => {
  /** The item ids the client was asked to record an impression for. */
  function impressions(c: TestClient): string[] {
    return c.recordEvidence.mock.calls
      .filter((call) => call[0] === "impression")
      .map((call) => (call[2] as UserRecommendationItem).id)
  }

  type Hook = ReturnType<typeof renderController>

  /** A served slate with the row and one card reported visible. */
  async function watching(
    c: TestClient,
    options: UseHomeRecommendationsOptions = OPEN,
    strict = false,
  ): Promise<Hook> {
    const hook = renderController(options, c, { strict })
    act(() => hook.latest().reportShelfMounted())
    await flush()
    act(() => {
      hook.latest().reportShelfVisible(true)
      hook.latest().reportVisibleCards(["item-0"])
    })
    return hook
  }

  const dwell = async (ms = 1_000) => {
    await act(async () => {
      jest.advanceTimersByTime(ms)
    })
  }

  it("records one impression per card once every signal holds", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = await watching(c)
    await dwell(999)
    expect(impressions(c)).toEqual([])

    await dwell(1)
    expect(impressions(c)).toEqual(["item-0"])

    act(() => hook.latest().reportVisibleCards(["item-0", "item-1"]))
    await dwell()
    expect(impressions(c)).toEqual(["item-0", "item-1"])
  })

  it("records nothing while Home is blurred", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = await watching(c)
    hook.rerender({ gateOpen: true, focused: false })
    await dwell(5_000)
    expect(impressions(c)).toEqual([])

    hook.rerender(OPEN)
    await dwell()
    expect(impressions(c)).toEqual(["item-0"])
  })

  it("records nothing while the app is in the background", async () => {
    jest.useFakeTimers()
    const c = client()
    await watching(c)
    sendAppState("background")
    await dwell(5_000)
    expect(impressions(c)).toEqual([])

    sendAppState("active")
    await dwell()
    expect(impressions(c)).toEqual(["item-0"])
  })

  it("records nothing until Home's list reports the row visible", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    act(() => hook.latest().reportVisibleCards(["item-0"]))
    await dwell(5_000)
    expect(impressions(c)).toEqual([])

    act(() => hook.latest().reportShelfVisible(true))
    await dwell()
    expect(impressions(c)).toEqual(["item-0"])
  })

  it("records nothing once the row detaches", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = await watching(c)
    await dwell(900)
    act(() => hook.latest().reportShelfDetached())
    await dwell(5_000)
    expect(impressions(c)).toEqual([])
  })

  it("records nothing after the controller unmounts", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = await watching(c)
    await dwell(900)
    hook.unmount()
    await dwell(5_000)
    expect(impressions(c)).toEqual([])
    expect(appStateHandlers).toHaveLength(0)
  })

  it("records the same card again for the next slate", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = await watching(c)
    await dwell()
    expect(impressions(c)).toEqual(["item-0"])

    act(() => hook.latest().refresh())
    await flush()
    await dwell()
    expect(impressions(c)).toEqual(["item-0", "item-0"])
  })

  it("keeps its per-slate record across a re-render", async () => {
    jest.useFakeTimers()
    const c = client()
    const hook = await watching(c)
    await dwell()
    expect(impressions(c)).toEqual(["item-0"])

    // A tracker rebuilt on any render would lose what it already recorded and
    // send a second impression for the same card the next time it scrolls in.
    hook.rerender(OPEN)
    act(() => {
      hook.latest().reportVisibleCards([])
      hook.latest().reportVisibleCards(["item-0"])
    })
    await dwell(5_000)
    expect(impressions(c)).toEqual(["item-0"])
  })

  it("still records through a StrictMode mount cycle", async () => {
    jest.useFakeTimers()
    const c = client()
    await watching(c, OPEN, true)
    // One listener, not two: the cleanup removed the first subscription, and
    // the second setup re-armed the tracker it suspended.
    expect(appStateHandlers).toHaveLength(1)

    await dwell()
    expect(impressions(c)).toEqual(["item-0"])
  })
})

// ── The row's own visibility (R8) ───────────────────────────────────────────

describe("the row's viewport flag", () => {
  it("starts in view, then follows Home's list", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    // The row mounts before the list has ever reported. Collapsing a terminal
    // outcome on that silence is the layout jump R8 forbids.
    expect(hook.latest().shelfInView).toBe(true)

    act(() => hook.latest().reportShelfVisible(false))
    expect(hook.latest().shelfInView).toBe(false)

    act(() => hook.latest().reportShelfVisible(true))
    expect(hook.latest().shelfInView).toBe(true)
  })

  it("holds the same reporter identity across a refetch", async () => {
    const c = client()
    const hook = renderController(OPEN, c)
    act(() => hook.latest().reportShelfMounted())
    await flush()
    const before = hook.latest()

    act(() => before.refresh())
    await flush()
    const after = hook.latest()
    expect(after.slate?.requestId).toBe("req-2")
    // Anti-vacuous: two absent reporters would also compare equal.
    expect(typeof after.reportShelfVisible).toBe("function")
    expect(after.reportShelfVisible).toBe(before.reportShelfVisible)
    expect(after.reportVisibleCards).toBe(before.reportVisibleCards)
    expect(after.reportShelfDetached).toBe(before.reportShelfDetached)
  })
})
