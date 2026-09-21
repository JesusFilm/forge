/**
 * Decision coverage for the slate hook (feat-516): the retry cadence, the
 * terminal states, the evidence handoff and the single-flight selection. The
 * client is injected, so no Apollo, no viewer store and no native module
 * take part; jest's fake timers drive the delayed retry.
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

import { act } from "react"
import type React from "react"

import type {
  DeliveryResult,
  UserRecommendationItem,
  UserRecommendationSlate,
} from "../../lib/recommendations/delivery"
import {
  DELIVERY_ATTEMPTS,
  DELIVERY_RETRY_DELAY_MS,
  useUserRecommendations,
  type UseUserRecommendationsOptions,
  type UseUserRecommendationsResult,
  type UserRecommendationsClient,
} from "../useUserRecommendations"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

function item(index: number): UserRecommendationItem {
  return {
    id: `item-${index}`,
    position: index,
    targetMediaId: `media-${index}`,
    canonicalHref: `https://www.jesusfilm.org/watch/video-${index}.html/english.html`,
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

const SLATE: UserRecommendationSlate = {
  requestId: "req-1",
  expiresAt: null,
  cohort: "cold_start",
  profileCount: 0,
  curatedCount: 6,
  poolVersion: null,
  items: Array.from({ length: 6 }, (_, index) => item(index)),
}

function client(
  overrides: Partial<UserRecommendationsClient> = {},
): UserRecommendationsClient & {
  fetch: jest.Mock
  recordEvidence: jest.Mock
  select: jest.Mock
} {
  return {
    fetch: jest.fn(
      async () => ({ kind: "served", slate: SLATE }) as DeliveryResult,
    ),
    recordEvidence: jest.fn(async () => "sent"),
    select: jest.fn(async (_slate, entry: UserRecommendationItem) => ({
      videoSlug: entry.videoSlug,
      targetMediaId: entry.targetMediaId,
      claimNonce: "n".repeat(32),
      acknowledged: true,
    })),
    ...overrides,
  } as never
}

const mounted: TestInstance[] = []

function renderHook(
  initial: UseUserRecommendationsOptions,
  useClient: UserRecommendationsClient,
) {
  const seen: UseUserRecommendationsResult[] = []
  function Harness(props: UseUserRecommendationsOptions) {
    seen.push(useUserRecommendations(props, useClient))
    return null
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (<Harness {...initial} />) as unknown as React.ReactElement,
    )
  })
  mounted.push(renderer)
  return {
    latest: () => seen[seen.length - 1]!,
    rerender: (next: UseUserRecommendationsOptions) =>
      act(() => {
        renderer.update(
          (<Harness {...next} />) as unknown as React.ReactElement,
        )
      }),
    unmount: () => act(() => renderer.unmount()),
  }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

const OPTIONS: UseUserRecommendationsOptions = {
  locale: "en",
  audioLanguageSlug: "english",
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.useRealTimers()
})

describe("useUserRecommendations", () => {
  it("loads once and serves the slate in position order", async () => {
    const c = client()
    const hook = renderHook(OPTIONS, c)
    expect(hook.latest().status).toBe("loading")
    await flush()
    expect(hook.latest().status).toBe("served")
    expect(hook.latest().items.map((entry) => entry.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    expect(c.fetch).toHaveBeenCalledTimes(1)
    expect(c.fetch).toHaveBeenCalledWith({
      locale: "en",
      audioLanguageSlug: "english",
      count: 6,
      attempt: 1,
    })
  })

  it("retries a transient answer after the delay, up to three attempts", async () => {
    jest.useFakeTimers()
    const c = client({
      fetch: jest.fn(
        async () =>
          ({
            kind: "unavailable",
            reason: "cooldown",
            retryable: true,
          }) as DeliveryResult,
      ),
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    expect(hook.latest().status).toBe("loading")
    for (let attempt = 2; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
      await act(async () => {
        jest.advanceTimersByTime(DELIVERY_RETRY_DELAY_MS)
      })
      await flush()
      expect(c.fetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ attempt }),
      )
    }
    expect(c.fetch).toHaveBeenCalledTimes(DELIVERY_ATTEMPTS)
    expect(hook.latest().status).toBe("unavailable")
    expect(hook.latest().reason).toBe("cooldown")
  })

  it("does not retry a non-retryable answer", async () => {
    const c = client({
      fetch: jest.fn(
        async () =>
          ({
            kind: "unavailable",
            reason: "coverage_unavailable",
            retryable: false,
          }) as DeliveryResult,
      ),
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    expect(hook.latest().status).toBe("unavailable")
    expect(hook.latest().reason).toBe("coverage_unavailable")
    expect(c.fetch).toHaveBeenCalledTimes(1)
  })

  it.each(["disabled", "unprovisioned"] as const)(
    "reports %s as a terminal status",
    async (kind) => {
      const c = client({
        fetch: jest.fn(async () => ({ kind }) as DeliveryResult),
      })
      const hook = renderHook(OPTIONS, c)
      await flush()
      expect(hook.latest().status).toBe(kind)
      expect(hook.latest().items).toEqual([])
    },
  )

  it("stays idle and sends nothing when disabled by the caller", async () => {
    const c = client()
    const hook = renderHook({ ...OPTIONS, enabled: false }, c)
    await flush()
    expect(hook.latest().status).toBe("idle")
    expect(c.fetch).not.toHaveBeenCalled()
  })

  it("serves no items, evidence or selection once the caller switches it off", async () => {
    const c = client()
    const hook = renderHook(OPTIONS, c)
    await flush()
    expect(hook.latest().items).toHaveLength(6)
    hook.rerender({ ...OPTIONS, enabled: false })
    expect(hook.latest().status).toBe("idle")
    expect(hook.latest().items).toEqual([])
    expect(hook.latest().slate).toBeNull()
    act(() => hook.latest().recordRender("item-1"))
    expect(c.recordEvidence).not.toHaveBeenCalled()
    await expect(hook.latest().select("item-1")).resolves.toBeNull()
    expect(c.select).not.toHaveBeenCalled()
  })

  it("clears a stale reason once the caller switches it off", async () => {
    const c = client({
      fetch: jest.fn(
        async () =>
          ({
            kind: "unavailable",
            reason: "coverage_unavailable",
            retryable: false,
          }) as DeliveryResult,
      ),
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    expect(hook.latest().reason).toBe("coverage_unavailable")
    hook.rerender({ ...OPTIONS, enabled: false })
    expect(hook.latest().status).toBe("idle")
    expect(hook.latest().reason).toBeNull()
  })

  it("refreshes on a context change and on refresh()", async () => {
    const c = client()
    const hook = renderHook(OPTIONS, c)
    await flush()
    hook.rerender({ ...OPTIONS, audioLanguageSlug: "french" })
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
    expect(c.fetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ audioLanguageSlug: "french" }),
    )
    act(() => hook.latest().refresh())
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(3)
  })

  it("hands render and impression evidence to the client with the served slate", async () => {
    const c = client()
    const hook = renderHook(OPTIONS, c)
    await flush()
    act(() => {
      hook.latest().recordRender("item-2")
      hook.latest().recordImpression("item-2")
      hook.latest().recordRender("missing")
    })
    expect(c.recordEvidence).toHaveBeenCalledTimes(2)
    expect(c.recordEvidence.mock.calls[0]?.[0]).toBe("render")
    expect(c.recordEvidence.mock.calls[0]?.[1]).toBe(SLATE)
    expect(c.recordEvidence.mock.calls[0]?.[2]).toEqual(item(2))
    expect(c.recordEvidence.mock.calls[1]?.[0]).toBe("impression")
  })

  it("selects once at a time and resolves with the slug to open", async () => {
    let release: () => void = () => undefined
    const c = client({
      select: jest.fn(
        (_slate: UserRecommendationSlate, entry: UserRecommendationItem) =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                videoSlug: entry.videoSlug,
                targetMediaId: entry.targetMediaId,
                claimNonce: "n".repeat(32),
                acknowledged: true,
              })
          }),
      ),
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    let first: Promise<unknown> = Promise.resolve()
    let second: unknown
    await act(async () => {
      first = hook.latest().select("item-1")
      second = await hook.latest().select("item-3")
    })
    expect(second).toBeNull()
    expect(c.select).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toMatchObject({ videoSlug: "video-1" })
  })

  it("keeps a selection single-flight across a profile refresh", async () => {
    const listeners = new Set<() => void>()
    let release: () => void = () => undefined
    const c = client({
      subscribeProfile: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      select: jest.fn(
        (_slate: UserRecommendationSlate, entry: UserRecommendationItem) =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                videoSlug: entry.videoSlug,
                targetMediaId: entry.targetMediaId,
                claimNonce: "n".repeat(32),
                acknowledged: true,
              })
          }),
      ),
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    let first: Promise<unknown> = Promise.resolve()
    await act(async () => {
      first = hook.latest().select("item-1")
    })
    // An identity replacement lands while the selection is still pending.
    act(() => {
      for (const listener of listeners) listener()
    })
    await flush()
    expect(hook.latest().status).toBe("served")
    let second: unknown
    await act(async () => {
      second = await hook.latest().select("item-3")
    })
    expect(second).toBeNull()
    expect(c.select).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toMatchObject({ videoSlug: "video-1" })
  })

  it("ignores a selection before a slate is served", async () => {
    const c = client({ fetch: jest.fn(() => new Promise(() => undefined)) })
    const hook = renderHook(OPTIONS, c)
    await flush()
    await expect(hook.latest().select("item-1")).resolves.toBeNull()
    expect(c.select).not.toHaveBeenCalled()
  })

  it("sends no evidence or selection on an expired slate", async () => {
    const expiring = {
      ...SLATE,
      expiresAt: "2026-09-16T00:10:00.000Z",
    }
    let now = Date.parse("2026-09-16T00:05:00.000Z")
    const c = client({
      fetch: jest.fn(
        async () => ({ kind: "served", slate: expiring }) as DeliveryResult,
      ),
      now: () => now,
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    act(() => hook.latest().recordRender("item-1"))
    expect(c.recordEvidence).toHaveBeenCalledTimes(1)
    now = Date.parse("2026-09-16T00:10:00.000Z")
    act(() => hook.latest().recordImpression("item-1"))
    expect(c.recordEvidence).toHaveBeenCalledTimes(1)
    await expect(hook.latest().select("item-1")).resolves.toBeNull()
    expect(c.select).not.toHaveBeenCalled()
  })

  it("refreshes when the profile changes", async () => {
    const listeners = new Set<() => void>()
    const c = client({
      subscribeProfile: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    const hook = renderHook(OPTIONS, c)
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(1)
    act(() => {
      for (const listener of listeners) listener()
    })
    await flush()
    expect(c.fetch).toHaveBeenCalledTimes(2)
    hook.unmount()
    expect(listeners.size).toBe(0)
  })
})
