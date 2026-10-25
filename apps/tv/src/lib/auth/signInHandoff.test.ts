import {
  HANDOFF_CONFIRMATION_MS,
  HANDOFF_MAX_WAIT_MS,
  remainingConfirmationDelayMs,
  shouldHandOffToHome,
} from "./signInHandoff"

describe("shouldHandOffToHome", () => {
  const FRESH = {
    grantCompleted: true,
    signedIn: true,
    alreadyHandedOff: false,
  }

  it("hands off after a fresh grant on a signed-in session", () => {
    expect(shouldHandOffToHome(FRESH)).toBe(true)
  })

  // Each refusal is its own case: these are the paths that ALSO produce a
  // signed-in session, and sending any of them to Home would make the Profile
  // screen impossible to open.
  it("does NOT hand off a stored session adopted at launch", () => {
    expect(shouldHandOffToHome({ ...FRESH, grantCompleted: false })).toBe(false)
  })

  it("does NOT hand off a deliberate Profile visit while already signed in", () => {
    // Same shape as above — no grant completed in this mount — stated
    // separately because it is the case a reader is most likely to break.
    expect(
      shouldHandOffToHome({
        grantCompleted: false,
        signedIn: true,
        alreadyHandedOff: false,
      }),
    ).toBe(false)
  })

  it("does not hand off before the session is signed in", () => {
    expect(shouldHandOffToHome({ ...FRESH, signedIn: false })).toBe(false)
  })

  it("is once-only", () => {
    expect(shouldHandOffToHome({ ...FRESH, alreadyHandedOff: true })).toBe(
      false,
    )
  })
})

describe("remainingConfirmationDelayMs", () => {
  it("waits the remainder of the floor when the grant just landed", () => {
    expect(remainingConfirmationDelayMs(1_000, 1_000)).toBe(
      HANDOFF_CONFIRMATION_MS,
    )
    expect(remainingConfirmationDelayMs(1_000, 1_200)).toBe(
      HANDOFF_CONFIRMATION_MS - 200,
    )
  })

  it("waits nothing once the floor has already passed", () => {
    // The common case: the aftermath's network round trips outlast the floor,
    // so the confirmation was already on screen long enough.
    expect(
      remainingConfirmationDelayMs(1_000, 1_000 + HANDOFF_CONFIRMATION_MS),
    ).toBe(0)
    expect(remainingConfirmationDelayMs(1_000, 60_000)).toBe(0)
  })

  it("never returns a negative or above-floor delay", () => {
    for (const now of [-5_000, 0, 999, 1_000, 5_000, 1e12]) {
      const delay = remainingConfirmationDelayMs(1_000, now)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(HANDOFF_CONFIRMATION_MS)
    }
  })

  it("falls back to the full floor on a non-finite or backwards clock", () => {
    // A device clock that jumps backwards mid-flow must not produce a wait
    // longer than the floor (or a negative one, which fires instantly).
    expect(remainingConfirmationDelayMs(5_000, 1_000)).toBe(
      HANDOFF_CONFIRMATION_MS,
    )
    expect(remainingConfirmationDelayMs(Number.NaN, 1_000)).toBe(
      HANDOFF_CONFIRMATION_MS,
    )
    expect(remainingConfirmationDelayMs(1_000, Number.POSITIVE_INFINITY)).toBe(
      HANDOFF_CONFIRMATION_MS,
    )
  })

  it("honours an explicit floor", () => {
    expect(remainingConfirmationDelayMs(1_000, 1_000, 500)).toBe(500)
    expect(remainingConfirmationDelayMs(1_000, 1_400, 500)).toBe(100)
  })
})

describe("budgets", () => {
  it("caps the aftermath wait well above the confirmation floor", () => {
    // The floor is a MINIMUM hold and the cap a MAXIMUM wait; a cap at or
    // below the floor would make the wait-for-merge step dead code.
    expect(HANDOFF_MAX_WAIT_MS).toBeGreaterThan(HANDOFF_CONFIRMATION_MS)
  })

  it("keeps the whole handoff inside a few seconds", () => {
    // Worst case the viewer stares at the code screen for cap + floor.
    expect(HANDOFF_MAX_WAIT_MS + HANDOFF_CONFIRMATION_MS).toBeLessThanOrEqual(
      6_000,
    )
  })
})
