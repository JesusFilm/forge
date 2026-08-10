import {
  applyLocalProgress,
  bufferProgressIntent,
  drainProgressIntents,
  getProgressEntry,
  getProgressSnapshot,
  hydrateProgress,
  peekProgressIntents,
  resetToSignedOut,
  subscribeToProgress,
  type WatchProgressEntry,
} from "../store"

function entry(
  videoId: string,
  overrides: Partial<WatchProgressEntry> = {},
): WatchProgressEntry {
  return {
    videoId,
    languageSlug: null,
    positionSeconds: 30,
    durationSeconds: 100,
    completed: false,
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  resetToSignedOut()
})

describe("progress store", () => {
  it("hydrates account-tagged entries readable without React", () => {
    hydrateProgress({ accountId: "user-1", entries: [entry("video-1")] })

    expect(getProgressSnapshot().accountId).toBe("user-1")
    expect(getProgressEntry("video-1")?.positionSeconds).toBe(30)
  })

  it("notifies subscribers on commit with a fresh snapshot identity", () => {
    const before = getProgressSnapshot()
    const listener = jest.fn()
    subscribeToProgress(listener)

    hydrateProgress({ accountId: "user-1", entries: [entry("video-1")] })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getProgressSnapshot()).not.toBe(before)
  })

  it("applies local echoes only for the signed-in account (R10)", () => {
    hydrateProgress({ accountId: "user-1", entries: [] })

    applyLocalProgress("user-2", entry("video-1"))
    expect(getProgressEntry("video-1")).toBeUndefined()

    applyLocalProgress("user-1", entry("video-1"))
    expect(getProgressEntry("video-1")).toBeDefined()
  })

  it("sign-out reset empties entries and buffered intents", () => {
    hydrateProgress({ accountId: "user-1", entries: [entry("video-1")] })
    bufferProgressIntent({
      videoId: "video-1",
      languageSlug: null,
      positionSeconds: 44,
      durationSeconds: 100,
      recordedAt: "2026-08-04T00:01:00.000Z",
    })

    resetToSignedOut()

    expect(getProgressSnapshot().accountId).toBeNull()
    expect(getProgressSnapshot().entries.size).toBe(0)
    expect(peekProgressIntents()).toEqual([])
  })
})

describe("buffered write intents (KTD5)", () => {
  const intent = (overrides: Record<string, unknown> = {}) => ({
    videoId: "video-1",
    languageSlug: null,
    positionSeconds: 10,
    durationSeconds: 100,
    recordedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  })

  it("keeps only the newest intent per video identity", () => {
    bufferProgressIntent(intent({ positionSeconds: 10 }))
    bufferProgressIntent(
      intent({ positionSeconds: 20, recordedAt: "2026-08-04T00:00:02.000Z" }),
    )

    const drained = drainProgressIntents()
    expect(drained).toHaveLength(1)
    expect(drained[0]?.positionSeconds).toBe(20)
  })

  it("keys slug-identified (offline) intents separately from id-identified ones", () => {
    bufferProgressIntent(intent())
    bufferProgressIntent(
      intent({ videoId: undefined, videoSlug: "birth-of-jesus" }),
    )

    expect(peekProgressIntents()).toHaveLength(2)
  })

  it("drains to empty, and a later intent starts a fresh batch", () => {
    // Failed sends no longer come back here — they persist to the durable
    // account-bound queue — so the buffer only ever holds unsent samples.
    bufferProgressIntent(intent({ positionSeconds: 10 }))
    expect(drainProgressIntents()).toHaveLength(1)
    expect(peekProgressIntents()).toEqual([])

    bufferProgressIntent(
      intent({ positionSeconds: 30, recordedAt: "2026-08-04T00:00:05.000Z" }),
    )

    const drained = drainProgressIntents()
    expect(drained).toHaveLength(1)
    expect(drained[0]?.positionSeconds).toBe(30)
  })

  it("ignores intents with no identity", () => {
    bufferProgressIntent(intent({ videoId: undefined }))
    expect(peekProgressIntents()).toEqual([])
  })
})
