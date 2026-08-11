import type { WatchProgressEntry } from "../store"
import {
  PROGRESS_BATCH_INTERVAL_MS,
  planBatchSend,
  resolveProgressEntries,
} from "../syncPlan"

function entry(videoId: string): WatchProgressEntry {
  return {
    videoId,
    languageSlug: null,
    positionSeconds: 30,
    durationSeconds: 100,
    completed: false,
    updatedAt: "2026-08-04T00:00:00.000Z",
  }
}

describe("resolveProgressEntries (fail-open, R11)", () => {
  it("uses fresh entries on success and remembers them as last-good", () => {
    const fresh = [entry("video-1")]
    expect(resolveProgressEntries({ ok: true, entries: fresh }, null)).toEqual({
      entries: fresh,
      nextLastGood: fresh,
    })
  })

  it("an empty success renders empty but never clobbers a populated last-good cache", () => {
    const lastGood = [entry("video-1")]
    const resolved = resolveProgressEntries({ ok: true, entries: [] }, lastGood)

    expect(resolved.entries).toEqual([])
    expect(resolved.nextLastGood).toBe(lastGood)
  })

  it("a failed read reuses last-good so bars never blank on a blip", () => {
    const lastGood = [entry("video-1")]
    expect(resolveProgressEntries({ ok: false }, lastGood)).toEqual({
      entries: lastGood,
      nextLastGood: lastGood,
    })
  })

  it("a failed read with no last-good degrades to empty (app behaves as today)", () => {
    expect(resolveProgressEntries({ ok: false }, null)).toEqual({
      entries: [],
      nextLastGood: null,
    })
  })
})

describe("planBatchSend (KTD5 rate-limit budget)", () => {
  it("sends immediately on the first buffered batch", () => {
    const plan = planBatchSend({
      state: { lastSentAt: null },
      now: 1_000,
      forced: false,
      hasIntents: true,
    })
    expect(plan.send).toBe(true)
    expect(plan.nextState.lastSentAt).toBe(1_000)
  })

  it("emits at most one send per 30-second window", () => {
    let state = { lastSentAt: null as number | null }
    let sends = 0
    // Two minutes of once-per-second ticks with intents pending.
    for (let t = 0; t < 120_000; t += 1_000) {
      const plan = planBatchSend({
        state,
        now: t,
        forced: false,
        hasIntents: true,
      })
      if (plan.send) sends += 1
      state = plan.nextState
    }
    expect(sends).toBe(4)
  })

  it("a forced trigger sends immediately regardless of the window", () => {
    const plan = planBatchSend({
      state: { lastSentAt: 1_000 },
      now: 2_000,
      forced: true,
      hasIntents: true,
    })
    expect(plan.send).toBe(true)
    expect(plan.nextState.lastSentAt).toBe(2_000)
  })

  it("never sends without buffered intents", () => {
    const plan = planBatchSend({
      state: { lastSentAt: null },
      now: PROGRESS_BATCH_INTERVAL_MS * 2,
      forced: true,
      hasIntents: false,
    })
    expect(plan.send).toBe(false)
  })
})
