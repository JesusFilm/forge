import {
  ENTRANCE_DURATION_MS,
  ENTRANCE_MAX_STAGGER_STEPS,
  ENTRANCE_STAGGER_MS,
  REVEAL_FALLBACK_MS,
  entranceDelayMs,
} from "./searchEntrance"

describe("entranceDelayMs", () => {
  it("staggers the first batch from zero", () => {
    expect(entranceDelayMs(0, 0)).toBe(0)
    expect(entranceDelayMs(1, 0)).toBe(ENTRANCE_STAGGER_MS)
    expect(entranceDelayMs(3, 0)).toBe(3 * ENTRANCE_STAGGER_MS)
  })

  // The bug: page 2 lands at absolute indices 20-39, so an absolute-index
  // stagger held those cards invisible for 1.2-2.6s after they were appended.
  it("restarts the stagger at each appended batch", () => {
    expect(entranceDelayMs(20, 20)).toBe(0)
    expect(entranceDelayMs(21, 20)).toBe(ENTRANCE_STAGGER_MS)
    expect(entranceDelayMs(40, 40)).toBe(0)
  })

  it("caps the stagger so a full page finishes appearing promptly", () => {
    const capped = ENTRANCE_MAX_STAGGER_STEPS * ENTRANCE_STAGGER_MS
    expect(entranceDelayMs(ENTRANCE_MAX_STAGGER_STEPS, 0)).toBe(capped)
    expect(entranceDelayMs(19, 0)).toBe(capped)
    expect(entranceDelayMs(39, 20)).toBe(capped)
  })

  it("never returns a negative delay for an index behind its batch start", () => {
    expect(entranceDelayMs(0, 20)).toBe(0)
    expect(entranceDelayMs(-5, 0)).toBe(0)
  })

  it("keeps a whole batch's entrance under half a second of stagger", () => {
    expect(entranceDelayMs(39, 20) + ENTRANCE_DURATION_MS).toBeLessThan(1000)
  })
})

describe("REVEAL_FALLBACK_MS", () => {
  // The footer holds its loading state until the list reports the appended rows
  // laid out. This ceiling only fires if that report never comes, so it must sit
  // above a full batch's entrance or it would pre-empt the real signal.
  it("exceeds the slowest card's full entrance", () => {
    expect(REVEAL_FALLBACK_MS).toBeGreaterThan(
      ENTRANCE_MAX_STAGGER_STEPS * ENTRANCE_STAGGER_MS + ENTRANCE_DURATION_MS,
    )
  })
})
