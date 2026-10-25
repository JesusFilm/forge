import { beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/admin-client", () => ({ default: { query: queryMock } }))

import { resolveSeriesBySlug } from "@/lib/content"
import {
  buildAdminQueryImplementation,
  operationName,
  TWO_EPISODES,
  type EpisodePlan,
} from "@/lib/__tests__/fixtures/rivka-series-container"

// A series CONTAINER owns no dubs of its own in any language — admin's
// `preferredPlayableDub` resolves against the container's own dub rows, and a
// container has none. Its playability can only come from a descendant, so the
// resolver has to fall through to a playable episode in the REQUESTED
// language. Regression guard for the Rivka report: "no segments available to
// play" on a series whose twelve episodes all carry published Mandarin dubs.

function mockAdmin(plan: EpisodePlan) {
  queryMock.mockReset()
  queryMock.mockImplementation(buildAdminQueryImplementation(plan))
}

/** Slugs admin was asked for, in call order — the round-trip ledger. */
function snapshotSlugsRequested(): string[] {
  return queryMock.mock.calls
    .filter(
      ([arg]) =>
        operationName(arg.query) === "GetWatchVideoRouteSnapshotBySlug",
    )
    .map(([arg]) => String(arg.variables.videoSlug))
}

function callCount(operation: string): number {
  return queryMock.mock.calls.filter(
    ([arg]) => operationName(arg.query) === operation,
  ).length
}

beforeEach(() => {
  mockAdmin(TWO_EPISODES)
})

describe("resolveSeriesBySlug — container with zero own variants", () => {
  it("resolves a Mandarin episode dub for a Mandarin request", async () => {
    const resolved = await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(resolved).not.toBeNull()
    expect(resolved?.selectedVariant).not.toBeNull()
    expect(resolved?.selectedVariant?.language?.slug).toBe("mandarin-china")
    expect(resolved?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-1/mandarin-china.m3u8",
    )
    // The container itself still owns no variants — the hero variant is
    // borrowed from the descendant, not grafted onto the container record.
    expect(resolved?.video.variants).toEqual([])
  })

  it("resolves an English episode dub for an English request", async () => {
    const resolved = await resolveSeriesBySlug("rivka", "english")

    expect(resolved?.selectedVariant?.language?.slug).toBe("english")
    expect(resolved?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-1/english.m3u8",
    )
  })

  it("keeps the hero empty rather than serving the wrong language", async () => {
    // Episodes are English-only. Admin's preferredPlayableDub still answers a
    // Mandarin request with the English dub, so an unchecked fall-through
    // would hand a Mandarin URL an English stream.
    mockAdmin({ "rivka-1": ["english"], "rivka-2": ["english"] })

    const resolved = await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(resolved).not.toBeNull()
    expect(resolved?.selectedVariant).toBeNull()
  })

  it("falls through to a later episode when the first lacks the language", async () => {
    // Coverage is per-episode: episode 1 can be English-only while the series
    // genuinely has Mandarin from episode 2 on. Falsifies the probe loop —
    // stopping after the first child leaves this hero empty.
    mockAdmin({
      "rivka-1": ["english"],
      "rivka-2": ["english", "mandarin"],
    })

    const resolved = await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(resolved?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-2/mandarin-china.m3u8",
    )
    expect(snapshotSlugsRequested()).toEqual(["rivka", "rivka-1", "rivka-2"])
  })

  it("probes at most SERIES_DESCENDANT_VARIANT_PROBE_LIMIT episodes", async () => {
    // The known limit of this fix, made explicit: a series whose only Mandarin
    // dub starts at episode four keeps the static hero. Falsifies the bound —
    // without the slice this resolves and the round-trip ledger grows.
    mockAdmin({
      "rivka-1": ["english"],
      "rivka-2": ["english"],
      "rivka-3": ["english"],
      "rivka-4": ["english", "mandarin"],
      "rivka-5": ["english", "mandarin"],
    })

    const resolved = await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(resolved?.selectedVariant).toBeNull()
    expect(snapshotSlugsRequested()).toEqual([
      "rivka",
      "rivka-1",
      "rivka-2",
      "rivka-3",
    ])
  })

  it("does not spend a probe on a container child", async () => {
    // A nested container owns no dubs either, so probing it is a wasted
    // round-trip that costs a real episode its slot. Falsifies the
    // `!isSeriesRecord(child)` filter: without it the budget is spent on
    // nested-1, rivka-1, rivka-2 and the Mandarin dub on rivka-3 is missed.
    mockAdmin({
      "nested-1": [],
      "rivka-1": ["english"],
      "rivka-2": ["english"],
      "rivka-3": ["english", "mandarin"],
    })

    const resolved = await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(resolved?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-3/mandarin-china.m3u8",
    )
    expect(snapshotSlugsRequested()).not.toContain("nested-1")
  })

  it("continues past an episode admin cannot resolve", async () => {
    // Falsifies `if (!childRecord) continue` — without it this throws on the
    // null record instead of reaching episode 2.
    mockAdmin({
      "rivka-1": null,
      "rivka-2": ["english", "mandarin"],
    })

    const resolved = await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(resolved?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-2/mandarin-china.m3u8",
    )
  })

  it("costs one container fetch, one probe and one dub hydration when episode 1 matches", async () => {
    // Page-load budget evidence for the cache-miss path. These probes are
    // sequential, so each one lands on TTFB. The happy path is 2 snapshot
    // round-trips; the dub hydration is newly reachable because the series
    // branch never had a non-null selectedVariant to hydrate before.
    await resolveSeriesBySlug("rivka", "mandarin-china")

    expect(snapshotSlugsRequested()).toEqual(["rivka", "rivka-1"])
    expect(callCount("GetWatchVideoDubDetail")).toBe(1)
  })

  it("costs at most three probes when no episode matches", async () => {
    mockAdmin({
      "rivka-1": ["english"],
      "rivka-2": ["english"],
      "rivka-3": ["english"],
      "rivka-4": ["english"],
    })

    await resolveSeriesBySlug("rivka", "mandarin-china")

    // Worst case: container + 3 probes, and no hydration because the hero
    // stays static.
    expect(callCount("GetWatchVideoRouteSnapshotBySlug")).toBe(4)
    expect(callCount("GetWatchVideoDubDetail")).toBe(0)
  })
})
