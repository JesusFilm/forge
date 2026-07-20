/**
 * feat-267 hero stream retry cooldown. Pure-module branch tests (explicit
 * `now`, no clock stubbing) + the prefetchHeroStream seam under fake timers.
 * The hook's own wiring is simulator/E2E-verified (repo idiom: no renderHook).
 */

// The jest resolver maps "react" to @types/react under pnpm; the suite only
// exercises prefetchHeroStream (no hook render), so stub the module out.
jest.mock("react", () => ({
  useEffect: () => undefined,
  useRef: () => ({ current: 0 }),
  useState: () => [null, () => undefined],
}))
jest.mock("../../lib/apolloClient", () => ({
  getApolloClient: jest.fn(),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { getApolloClient } from "../../lib/apolloClient"
import { datadogLog } from "../../lib/datadog"
import {
  HERO_STREAM_COOLDOWN_BASE_MS,
  HERO_STREAM_COOLDOWN_MAX_MS,
  checkHeroStreamCooldown,
  clearAllHeroStreamCooldowns,
  clearHeroStreamCooldown,
  registerHeroStreamFailure,
  resetHeroStreamCooldownsForTests,
} from "../../lib/watchHome/heroStreamCooldown"
import { prefetchHeroStream } from "../useHeroStream"

const mockGetClient = getApolloClient as jest.Mock
const mockWarn = datadogLog.warn as jest.Mock

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  jest.clearAllMocks()
  resetHeroStreamCooldownsForTests()
})

afterEach(() => {
  jest.useRealTimers()
})

describe("heroStreamCooldown (pure module)", () => {
  const T0 = 1_000_000

  it("an unknown slug is never suppressed", () => {
    expect(checkHeroStreamCooldown("fresh", T0)).toEqual({
      suppressed: false,
      warnRemainingMs: null,
    })
  })

  it("suppresses inside the window; ONLY expiry re-allows an attempt", () => {
    registerHeroStreamFailure("jesus", T0)
    expect(checkHeroStreamCooldown("jesus", T0).suppressed).toBe(true)
    expect(
      checkHeroStreamCooldown("jesus", T0 + HERO_STREAM_COOLDOWN_BASE_MS - 1)
        .suppressed,
    ).toBe(true)
    // Same slug, same entry — nothing changed but the clock.
    expect(
      checkHeroStreamCooldown("jesus", T0 + HERO_STREAM_COOLDOWN_BASE_MS)
        .suppressed,
    ).toBe(false)
  })

  it("doubles the window per consecutive failure", () => {
    registerHeroStreamFailure("jesus", T0)
    const afterFirst = T0 + HERO_STREAM_COOLDOWN_BASE_MS
    registerHeroStreamFailure("jesus", afterFirst)
    expect(
      checkHeroStreamCooldown(
        "jesus",
        afterFirst + 2 * HERO_STREAM_COOLDOWN_BASE_MS - 1,
      ).suppressed,
    ).toBe(true)
    expect(
      checkHeroStreamCooldown(
        "jesus",
        afterFirst + 2 * HERO_STREAM_COOLDOWN_BASE_MS,
      ).suppressed,
    ).toBe(false)
  })

  it("caps the window at HERO_STREAM_COOLDOWN_MAX_MS", () => {
    let now = T0
    for (let i = 0; i < 12; i++) {
      registerHeroStreamFailure("jesus", now)
      now += HERO_STREAM_COOLDOWN_MAX_MS
    }
    registerHeroStreamFailure("jesus", now)
    expect(
      checkHeroStreamCooldown("jesus", now + HERO_STREAM_COOLDOWN_MAX_MS - 1)
        .suppressed,
    ).toBe(true)
    expect(
      checkHeroStreamCooldown("jesus", now + HERO_STREAM_COOLDOWN_MAX_MS)
        .suppressed,
    ).toBe(false)
  })

  it("success clears the progression back to the base window", () => {
    registerHeroStreamFailure("jesus", T0)
    registerHeroStreamFailure("jesus", T0 + HERO_STREAM_COOLDOWN_BASE_MS)
    clearHeroStreamCooldown("jesus")
    expect(checkHeroStreamCooldown("jesus", T0).suppressed).toBe(false)
    // Next failure starts over at the 60s base, not the doubled window.
    const t1 = T0 + 10 * HERO_STREAM_COOLDOWN_BASE_MS
    registerHeroStreamFailure("jesus", t1)
    expect(
      checkHeroStreamCooldown("jesus", t1 + HERO_STREAM_COOLDOWN_BASE_MS)
        .suppressed,
    ).toBe(false)
  })

  it("a same-window re-registration is a concurrent echo — backoff not doubled", () => {
    registerHeroStreamFailure("jesus", T0)
    // Hook + prefetch share one Apollo-deduped rejection: second register
    // lands milliseconds later, inside the open window.
    registerHeroStreamFailure("jesus", T0 + 5)
    expect(
      checkHeroStreamCooldown("jesus", T0 + HERO_STREAM_COOLDOWN_BASE_MS)
        .suppressed,
    ).toBe(false)
  })

  it("clearAllHeroStreamCooldowns releases every open window", () => {
    registerHeroStreamFailure("jesus", T0)
    registerHeroStreamFailure("goj", T0)
    clearAllHeroStreamCooldowns()
    expect(checkHeroStreamCooldown("jesus", T0 + 1).suppressed).toBe(false)
    expect(checkHeroStreamCooldown("goj", T0 + 1).suppressed).toBe(false)
  })

  it("grants the warn budget once per window, restored by a new window", () => {
    registerHeroStreamFailure("jesus", T0)
    const first = checkHeroStreamCooldown("jesus", T0 + 1_000)
    expect(first.warnRemainingMs).toBe(HERO_STREAM_COOLDOWN_BASE_MS - 1_000)
    expect(checkHeroStreamCooldown("jesus", T0 + 2_000).warnRemainingMs).toBe(
      null,
    )
    // A fresh failure opens a fresh window with a fresh warn budget.
    const t1 = T0 + HERO_STREAM_COOLDOWN_BASE_MS
    registerHeroStreamFailure("jesus", t1)
    expect(
      checkHeroStreamCooldown("jesus", t1 + 1_000).warnRemainingMs,
    ).not.toBeNull()
  })
})

describe("prefetchHeroStream cooldown seam", () => {
  it("suppressed slug: no query is issued and cooldown_skip logs once", () => {
    jest.useFakeTimers()
    jest.setSystemTime(5_000_000)
    const query = jest.fn()
    mockGetClient.mockReturnValue({ query })

    registerHeroStreamFailure("pf-suppressed", Date.now())
    prefetchHeroStream("pf-suppressed")
    prefetchHeroStream("pf-suppressed")

    expect(query).not.toHaveBeenCalled()
    expect(
      mockWarn.mock.calls.filter(([m]) => m === "hero_stream.cooldown_skip"),
    ).toHaveLength(1)
  })

  it("a failed prefetch opens a cooldown; only expiry re-allows the query", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(6_000_000)
    const query = jest.fn().mockRejectedValue(new Error("network down"))
    mockGetClient.mockReturnValue({ query })

    prefetchHeroStream("pf-fails")
    await flushMicrotasks()
    expect(query).toHaveBeenCalledTimes(1)

    // Within the window: the dedupe set released the slug, so ONLY the
    // cooldown explains the absent second query.
    prefetchHeroStream("pf-fails")
    await flushMicrotasks()
    expect(query).toHaveBeenCalledTimes(1)

    jest.setSystemTime(6_000_000 + HERO_STREAM_COOLDOWN_BASE_MS)
    prefetchHeroStream("pf-fails")
    await flushMicrotasks()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("a successful prefetch clears the slug's cooldown progression", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(7_000_000)
    const query = jest.fn().mockResolvedValue({ data: {} })
    mockGetClient.mockReturnValue({ query })

    registerHeroStreamFailure("pf-recovers", Date.now())
    jest.setSystemTime(7_000_000 + HERO_STREAM_COOLDOWN_BASE_MS)
    prefetchHeroStream("pf-recovers")
    await flushMicrotasks()
    expect(query).toHaveBeenCalledTimes(1)

    // Cleared: a later failure starts back at the base window, not doubled.
    registerHeroStreamFailure("pf-recovers", Date.now())
    expect(
      checkHeroStreamCooldown(
        "pf-recovers",
        Date.now() + HERO_STREAM_COOLDOWN_BASE_MS,
      ).suppressed,
    ).toBe(false)
  })
})
