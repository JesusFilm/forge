import {
  SLOW_DOWN_INCREMENT_MS,
  TRANSPORT_ERRORS_BEFORE_WARNING,
  initialDeviceGrantState,
  isExpired,
  onCodeIssued,
  onCodeRequested,
  onForegrounded,
  onPollOutcome,
  secondsRemaining,
  shouldPausePolling,
  shouldPoll,
  type DeviceGrantState,
} from "./deviceGrantMachine"

const NOW = 1_700_000_000_000

function waiting(overrides: Partial<Parameters<typeof onCodeIssued>[1]> = {}) {
  return onCodeIssued(
    initialDeviceGrantState,
    {
      userCode: "0194507302",
      verificationUri: "https://auth.jesusfilm.org/device",
      verificationUriComplete:
        "https://auth.jesusfilm.org/device?user_code=0194507302",
      expiresInSeconds: 900,
      intervalSeconds: 5,
      ...overrides,
    },
    NOW,
  )
}

describe("code issuance", () => {
  it("stores an absolute deadline, not a countdown", () => {
    // A TV that sleeps for an hour must not resume believing it has 12 minutes
    // left; only an absolute instant survives the gap.
    const s = waiting()
    expect(s.phase.kind).toBe("waiting")
    if (s.phase.kind !== "waiting") throw new Error("unreachable")
    expect(s.phase.expiresAtMs).toBe(NOW + 900_000)
  })

  it("schedules the first poll one interval out, not immediately", () => {
    // Polling instantly would always return authorization_pending and burn a
    // request against the server's per-IP bucket for nothing.
    expect(waiting().nextPollAtMs).toBe(NOW + 5000)
  })

  it("floors a nonsense interval rather than busy-looping", () => {
    const s = waiting({ intervalSeconds: 0 })
    if (s.phase.kind !== "waiting") throw new Error("unreachable")
    expect(s.phase.intervalMs).toBe(1000)
  })

  it("moves through a requesting phase so the screen can say so", () => {
    expect(onCodeRequested(initialDeviceGrantState).phase.kind).toBe(
      "requesting",
    )
  })
})

describe("poll scheduling", () => {
  it("does not poll before the interval has elapsed", () => {
    expect(shouldPoll(waiting(), NOW + 4999)).toBe(false)
  })

  it("polls once the interval has elapsed", () => {
    expect(shouldPoll(waiting(), NOW + 5000)).toBe(true)
  })

  it("never polls outside the waiting phase", () => {
    // Anti-vacuous companion: proves the phase guard carries weight rather
    // than the timing check alone.
    const granted = onPollOutcome(
      waiting(),
      { kind: "granted", tokens: { accessToken: "jfp_at_x" } },
      NOW,
    )
    expect(shouldPoll(granted, NOW + 10_000_000)).toBe(false)
  })
})

/**
 * One case per outcome kind, each reaching a state no other outcome produces.
 * A shared "keep polling on anything unrecognised" default would make several
 * of these deletable with nothing going red.
 */
describe("poll outcomes", () => {
  it("pending keeps waiting and re-arms one interval out", () => {
    const s = onPollOutcome(waiting(), { kind: "pending" }, NOW + 5000)
    expect(s.phase.kind).toBe("waiting")
    expect(s.nextPollAtMs).toBe(NOW + 10_000)
  })

  it("granted carries the tokens out", () => {
    const s = onPollOutcome(
      waiting(),
      {
        kind: "granted",
        tokens: { accessToken: "jfp_at_x", idToken: "e.y.z" },
      },
      NOW,
    )
    expect(s.phase).toMatchObject({
      kind: "granted",
      tokens: { accessToken: "jfp_at_x" },
    })
  })

  it("denied is its own terminal state, not an error", () => {
    // The viewer chose this; the screen should not apologise for a fault.
    const s = onPollOutcome(waiting(), { kind: "denied" }, NOW)
    expect(s.phase.kind).toBe("denied")
  })

  it("expired terminates rather than silently re-requesting", () => {
    const s = onPollOutcome(waiting(), { kind: "expired" }, NOW)
    expect(s.phase).toMatchObject({ kind: "error", code: "expired_token" })
  })

  it("an unrecognised error terminates instead of polling forever", () => {
    // RFC 8628 treats an unknown code as terminal. A permissive default would
    // spin against the rate limit while the screen looked healthy.
    const s = onPollOutcome(
      waiting(),
      { kind: "unknown_error", code: "invalid_client" },
      NOW,
    )
    expect(s.phase).toMatchObject({ kind: "error", code: "invalid_client" })
  })

  it("slow_down widens the interval cumulatively", () => {
    // RFC 8628 §3.5. One increment per occurrence, and it must not snap back.
    let s = onPollOutcome(waiting(), { kind: "slow_down" }, NOW)
    if (s.phase.kind !== "waiting") throw new Error("unreachable")
    expect(s.phase.intervalMs).toBe(5000 + SLOW_DOWN_INCREMENT_MS)

    s = onPollOutcome(s, { kind: "slow_down" }, NOW)
    if (s.phase.kind !== "waiting") throw new Error("unreachable")
    expect(s.phase.intervalMs).toBe(5000 + SLOW_DOWN_INCREMENT_MS * 2)
  })

  it("a later pending does not undo a slow_down penalty", () => {
    // The discriminating case: if the interval reset here, a client that is
    // genuinely too fast would oscillate between throttled and throttling.
    const slowed = onPollOutcome(waiting(), { kind: "slow_down" }, NOW)
    const then = onPollOutcome(slowed, { kind: "pending" }, NOW)
    if (then.phase.kind !== "waiting") throw new Error("unreachable")
    expect(then.phase.intervalMs).toBe(5000 + SLOW_DOWN_INCREMENT_MS)
  })

  it("transport errors keep polling instead of dropping the code", () => {
    // Hotel wifi is not a denial. Restarting would make the viewer re-read a
    // new code off the screen for no reason.
    const s = onPollOutcome(waiting(), { kind: "transport_error" }, NOW)
    expect(s.phase.kind).toBe("waiting")
    expect(s.consecutiveTransportErrors).toBe(1)
  })

  it("surfaces a degraded state only after repeated transport failures", () => {
    let s = waiting()
    for (let i = 0; i < TRANSPORT_ERRORS_BEFORE_WARNING - 1; i += 1) {
      s = onPollOutcome(s, { kind: "transport_error" }, NOW)
      if (s.phase.kind !== "waiting") throw new Error("unreachable")
      expect(s.phase.degraded).toBe(false)
    }
    s = onPollOutcome(s, { kind: "transport_error" }, NOW)
    if (s.phase.kind !== "waiting") throw new Error("unreachable")
    expect(s.phase.degraded).toBe(true)
  })

  it("one good poll clears the degraded warning", () => {
    let s = waiting()
    for (let i = 0; i < TRANSPORT_ERRORS_BEFORE_WARNING; i += 1) {
      s = onPollOutcome(s, { kind: "transport_error" }, NOW)
    }
    s = onPollOutcome(s, { kind: "pending" }, NOW)
    if (s.phase.kind !== "waiting") throw new Error("unreachable")
    expect(s.phase.degraded).toBe(false)
    expect(s.consecutiveTransportErrors).toBe(0)
  })

  it("ignores an outcome that arrives after a terminal state", () => {
    // A poll already in flight when the grant completes must not resurrect it.
    const granted = onPollOutcome(
      waiting(),
      { kind: "granted", tokens: { accessToken: "jfp_at_x" } },
      NOW,
    )
    expect(onPollOutcome(granted, { kind: "pending" }, NOW)).toBe(granted)
  })
})

describe("expiry", () => {
  it("is not expired before the deadline", () => {
    expect(isExpired(waiting(), NOW + 899_999)).toBe(false)
  })

  it("is expired at the deadline", () => {
    expect(isExpired(waiting(), NOW + 900_000)).toBe(true)
  })

  it("reports whole seconds remaining for the countdown", () => {
    expect(secondsRemaining(waiting(), NOW)).toBe(900)
    expect(secondsRemaining(waiting(), NOW + 899_500)).toBe(1)
    expect(secondsRemaining(waiting(), NOW + 900_000)).toBe(0)
  })

  it("reports nothing remaining outside the waiting phase", () => {
    expect(secondsRemaining(initialDeviceGrantState, NOW)).toBe(0)
  })
})

describe("app state", () => {
  it("pauses only on background, never on inactive", () => {
    // tvOS emits "inactive" as a foreground blip — Siri, control centre. A
    // `!== "active"` test would stop the poll every time the viewer summoned
    // Siri, and the code would expire sitting on screen.
    expect(shouldPausePolling("background")).toBe(true)
    expect(shouldPausePolling("inactive")).toBe(false)
    expect(shouldPausePolling("active")).toBe(false)
  })

  it("polls immediately on foreground rather than waiting a full interval", () => {
    // The viewer likely approved on their phone while the TV slept.
    const s = onForegrounded(waiting(), NOW + 600_000)
    expect(s.nextPollAtMs).toBe(NOW + 600_000)
  })

  it("preserves a slow_down penalty across a background trip", () => {
    const slowed = onPollOutcome(waiting(), { kind: "slow_down" }, NOW)
    const resumed = onForegrounded(slowed, NOW + 60_000)
    if (resumed.phase.kind !== "waiting") throw new Error("unreachable")
    expect(resumed.phase.intervalMs).toBe(5000 + SLOW_DOWN_INCREMENT_MS)
  })

  it("foregrounding does nothing outside the waiting phase", () => {
    const denied: DeviceGrantState = onPollOutcome(
      waiting(),
      { kind: "denied" },
      NOW,
    )
    expect(onForegrounded(denied, NOW)).toBe(denied)
  })
})
