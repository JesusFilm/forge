import {
  createSplashSession,
  getSplashSession,
  resetSplashSession,
  SPLASH_CEILING_MS,
  SPLASH_HOLD_MS,
  SPLASH_REDUCE_MOTION_BUDGET_MS,
  SPLASH_SKIP_DECISION_BUDGET_MS,
  type SplashSession,
  type SplashSessionDeps,
} from "../splashSession"

beforeEach(() => {
  jest.useFakeTimers()
  resetSplashSession()
})

afterEach(() => {
  jest.useRealTimers()
})

function makeSession(
  overrides: Partial<SplashSessionDeps> = {},
): SplashSession {
  return createSplashSession({
    isExternalLaunch: () => false,
    whenDeepLinkOriginsReady: () => Promise.resolve(),
    isReduceMotionEnabled: () => Promise.resolve(false),
    ...overrides,
  })
}

/** Moves the clock and lets the resolution promises settle. */
async function settle(ms = 0): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms)
}

async function visibleSession(
  overrides: Partial<SplashSessionDeps> = {},
): Promise<SplashSession> {
  const session = makeSession(overrides)
  session.start()
  await settle()
  return session
}

// KTD6: one predicate governs the cover, so every path that ends the session is
// asserted on its own. Two shipped defects in this app agreed on the happy path
// and diverged on exactly the failure paths the backstop existed to cover.
describe("every release path clears the one visibility predicate", () => {
  it("clears it when the floor elapses and Home has reported content", async () => {
    const session = await visibleSession()
    expect(session.getSnapshot().visible).toBe(true)
    session.reportHomeContent()
    await settle(SPLASH_HOLD_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("clears it at the ceiling with no report at all", async () => {
    const session = await visibleSession()
    await settle(SPLASH_CEILING_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("clears it when Home reports a failed fetch", async () => {
    const session = await visibleSession()
    session.reportHomeFailure()
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("clears it when an error panel asks for an immediate release", async () => {
    const session = await visibleSession()
    session.releaseImmediately()
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("never sets it on an external launch", async () => {
    const session = await visibleSession({ isExternalLaunch: () => true })
    expect(session.getSnapshot().visible).toBe(false)
    await settle(SPLASH_CEILING_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("keeps it false after a release, whatever arrives later", async () => {
    const session = await visibleSession()
    session.releaseImmediately()
    session.reportHomeContent()
    session.reportHomeFailure()
    session.start()
    await settle(SPLASH_CEILING_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })
})

describe("the immediate release (R5)", () => {
  it("ends the session before the floor has elapsed", async () => {
    const session = await visibleSession()
    await settle(SPLASH_HOLD_MS - 1)
    session.releaseImmediately()
    expect(session.getSnapshot().visible).toBe(false)
  })

  // The error panel can render before the skip decision lands, and a cover the
  // resolution raises afterwards would sit over the one diagnostic surface.
  it("ends the session before it has resolved, and resolution cannot revive it", async () => {
    const session = makeSession()
    session.start()
    session.releaseImmediately()
    expect(session.getSnapshot().resolved).toBe(true)
    expect(session.getSnapshot().visible).toBe(false)
    await settle()
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("ends the session even when it is called before start()", async () => {
    const session = makeSession()
    session.releaseImmediately()
    session.start()
    await settle()
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("reports a cut, while every other release reports a fade", async () => {
    const cut = await visibleSession()
    cut.releaseImmediately()
    expect(cut.getSnapshot().exit).toBe("cut")

    const floor = await visibleSession()
    floor.reportHomeContent()
    await settle(SPLASH_HOLD_MS)
    expect(floor.getSnapshot().exit).toBe("fade")

    const ceiling = await visibleSession()
    await settle(SPLASH_CEILING_MS)
    expect(ceiling.getSnapshot().exit).toBe("fade")

    const failure = await visibleSession()
    failure.reportHomeFailure()
    expect(failure.getSnapshot().exit).toBe("fade")
  })
})

describe("the 2.5 second hold (R3)", () => {
  // AE1: content arrives shortly before the floor.
  it("holds to the floor when content arrives at 1.8 seconds", async () => {
    const session = await visibleSession()
    await settle(1_800)
    session.reportHomeContent()
    expect(session.getSnapshot().visible).toBe(true)
    await settle(SPLASH_HOLD_MS - 1_800 - 1)
    expect(session.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(session.getSnapshot().visible).toBe(false)
  })

  // AE2: a warm cache paints almost at once. The brand moment still runs (KD2).
  it("holds to the floor when content arrives at 50 milliseconds", async () => {
    const session = await visibleSession()
    await settle(50)
    session.reportHomeContent()
    await settle(SPLASH_HOLD_MS - 50 - 1)
    expect(session.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("holds past the floor while Home has reported nothing", async () => {
    const session = await visibleSession()
    await settle(SPLASH_HOLD_MS)
    expect(session.getSnapshot().visible).toBe(true)
  })

  it("treats repeated content reports as one report", async () => {
    const session = await visibleSession()
    session.reportHomeContent()
    session.reportHomeContent()
    session.reportHomeContent()
    await settle(SPLASH_HOLD_MS - 1)
    expect(session.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(session.getSnapshot().visible).toBe(false)
  })
})

describe("the 6 second ceiling (R4)", () => {
  // AE3: Home never paints, so the ceiling is the only way forward.
  it("releases with no content report at all", async () => {
    const session = await visibleSession()
    await settle(SPLASH_CEILING_MS - 1)
    expect(session.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(session.getSnapshot().visible).toBe(false)
  })

  // The clock starts when the cover appears, not when start() is called, so a
  // slow skip decision cannot eat into the ceiling.
  it("arms when the splash becomes visible, not when start() is called", async () => {
    let openGate: (() => void) | undefined
    const session = makeSession({
      whenDeepLinkOriginsReady: () =>
        new Promise<void>((resolve) => {
          openGate = resolve
        }),
    })
    session.start()
    await settle(800)
    openGate?.()
    await settle()
    expect(session.getSnapshot().visible).toBe(true)
    await settle(SPLASH_CEILING_MS - 1)
    expect(session.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(session.getSnapshot().visible).toBe(false)
  })
})

describe("the skip decision (R6, KTD5)", () => {
  // AE5: the person asked for a destination directly. Never delay that.
  it("skips the splash entirely on an external launch", async () => {
    const session = await visibleSession({ isExternalLaunch: () => true })
    const snapshot = session.getSnapshot()
    expect(snapshot.resolved).toBe(true)
    expect(snapshot.visible).toBe(false)
    expect(snapshot.presentation).toBeNull()
  })

  it("reads the launch only after the deep-link gate opens", async () => {
    let openGate: (() => void) | undefined
    let external = true
    const session = makeSession({
      isExternalLaunch: () => external,
      whenDeepLinkOriginsReady: () =>
        new Promise<void>((resolve) => {
          openGate = resolve
        }),
    })
    session.start()
    await settle()
    external = false
    openGate?.()
    await settle()
    expect(session.getSnapshot().visible).toBe(true)
  })

  // A wrong skip removes the animation from every ordinary launch; a wrong play
  // delays one deep link. The budget therefore fails towards playing.
  it("plays rather than skips when the gate outlives its budget", async () => {
    const session = makeSession({
      isExternalLaunch: () => true,
      whenDeepLinkOriginsReady: () => new Promise<void>(() => {}),
    })
    session.start()
    await settle(SPLASH_SKIP_DECISION_BUDGET_MS)
    expect(session.getSnapshot().visible).toBe(true)
  })

  it("keeps both budgets strictly under the hold", () => {
    expect(SPLASH_SKIP_DECISION_BUDGET_MS).toBeLessThan(SPLASH_HOLD_MS)
    expect(SPLASH_REDUCE_MOTION_BUDGET_MS).toBeLessThan(SPLASH_HOLD_MS)
    expect(SPLASH_HOLD_MS).toBeLessThan(SPLASH_CEILING_MS)
  })
})

describe("Reduce Motion (R13, KTD7)", () => {
  it("holds the finished frame still when the setting is on", async () => {
    const session = await visibleSession({
      isReduceMotionEnabled: () => Promise.resolve(true),
    })
    expect(session.getSnapshot().presentation).toBe("still")
  })

  it("plays the motion when the setting is off", async () => {
    const session = await visibleSession()
    expect(session.getSnapshot().presentation).toBe("motion")
  })

  it("changes the presentation but neither the floor nor the ceiling", async () => {
    const still = await visibleSession({
      isReduceMotionEnabled: () => Promise.resolve(true),
    })
    still.reportHomeContent()
    await settle(SPLASH_HOLD_MS - 1)
    expect(still.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(still.getSnapshot().visible).toBe(false)

    const ceiling = await visibleSession({
      isReduceMotionEnabled: () => Promise.resolve(true),
    })
    await settle(SPLASH_CEILING_MS - 1)
    expect(ceiling.getSnapshot().visible).toBe(true)
    await settle(1)
    expect(ceiling.getSnapshot().visible).toBe(false)
  })

  it("reads the setting through the injected accessibility dependency", async () => {
    const isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
    const session = await visibleSession({ isReduceMotionEnabled })
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot().presentation).toBe("still")
  })

  // A hung accessibility read must not hold the first frame back.
  it("falls back to motion when the read outlives its budget", async () => {
    const session = makeSession({
      isReduceMotionEnabled: () => new Promise<boolean>(() => {}),
    })
    session.start()
    await settle(SPLASH_REDUCE_MOTION_BUDGET_MS)
    const snapshot = session.getSnapshot()
    expect(snapshot.visible).toBe(true)
    expect(snapshot.presentation).toBe("motion")
  })

  it("falls back to motion when the read rejects", async () => {
    const session = await visibleSession({
      isReduceMotionEnabled: () => Promise.reject(new Error("no bridge")),
    })
    expect(session.getSnapshot().presentation).toBe("motion")
  })
})

describe("one session per process (R7)", () => {
  // AE6: a resume from the background must show no splash.
  it("starts nothing on a second start() after the session ended", async () => {
    const session = await visibleSession()
    session.reportHomeContent()
    await settle(SPLASH_HOLD_MS)
    expect(session.getSnapshot().visible).toBe(false)

    session.start()
    await settle(SPLASH_CEILING_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })

  it("resolves the launch once, however many times start() is called", async () => {
    const isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
    const session = makeSession({ isReduceMotionEnabled })
    session.start()
    session.start()
    session.start()
    await settle()
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1)
  })
})

describe("the failed Home fetch (R15)", () => {
  // AE10: the retry card must be reachable as soon as there is something to
  // retry, so the failure does not wait out the ceiling.
  it("releases at once rather than holding to the ceiling", async () => {
    const session = await visibleSession()
    await settle(100)
    session.reportHomeFailure()
    expect(session.getSnapshot().visible).toBe(false)
    expect(session.getSnapshot().exit).toBe("fade")
  })

  it("releases before the floor has elapsed", async () => {
    const session = await visibleSession()
    session.reportHomeFailure()
    await settle(SPLASH_HOLD_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })
})

describe("the useSyncExternalStore contract (KTD11)", () => {
  it("returns the same object while nothing changes", async () => {
    const session = await visibleSession()
    const first = session.getSnapshot()
    expect(session.getSnapshot()).toBe(first)
    session.reportHomeContent()
    expect(session.getSnapshot()).toBe(first)
    await settle(SPLASH_HOLD_MS - 1)
    expect(session.getSnapshot()).toBe(first)
  })

  it("returns a new object on a change", async () => {
    const session = await visibleSession()
    const before = session.getSnapshot()
    session.releaseImmediately()
    expect(session.getSnapshot()).not.toBe(before)
  })

  it("notifies subscribers exactly once per release", async () => {
    const session = await visibleSession()
    const listener = jest.fn()
    session.subscribe(listener)
    session.releaseImmediately()
    expect(listener).toHaveBeenCalledTimes(1)
    session.releaseImmediately()
    session.reportHomeFailure()
    await settle(SPLASH_CEILING_MS)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("stops notifying an unsubscribed listener", async () => {
    const session = await visibleSession()
    const listener = jest.fn()
    session.subscribe(listener)()
    session.releaseImmediately()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("the module singleton", () => {
  it("hands the same session to every caller", () => {
    expect(getSplashSession()).toBe(getSplashSession())
  })

  it("hands a fresh session after a reset", () => {
    const first = getSplashSession()
    resetSplashSession()
    expect(getSplashSession()).not.toBe(first)
  })
})

// The verification the plan asks for: no ordering of inputs may leave the cover
// on screen past the ceiling.
describe("no ordering leaves the cover on screen past the ceiling", () => {
  const orderings: Array<[string, (session: SplashSession) => void]> = [
    ["nothing at all", () => {}],
    ["content only", (s) => s.reportHomeContent()],
    ["failure only", (s) => s.reportHomeFailure()],
    ["immediate release only", (s) => s.releaseImmediately()],
    [
      "content then failure",
      (s) => {
        s.reportHomeContent()
        s.reportHomeFailure()
      },
    ],
    [
      "failure then content",
      (s) => {
        s.reportHomeFailure()
        s.reportHomeContent()
      },
    ],
    [
      "immediate release then every other report",
      (s) => {
        s.releaseImmediately()
        s.reportHomeContent()
        s.reportHomeFailure()
        s.start()
      },
    ],
    [
      "repeated content then a restart",
      (s) => {
        s.reportHomeContent()
        s.reportHomeContent()
        s.start()
      },
    ],
  ]

  it.each(orderings)("ends the session after %s", async (_name, drive) => {
    const session = await visibleSession()
    drive(session)
    await settle(SPLASH_CEILING_MS + SPLASH_HOLD_MS)
    expect(session.getSnapshot().visible).toBe(false)
  })

  it.each(orderings)(
    "ends the session after %s reported before it resolves",
    async (_name, drive) => {
      const session = makeSession()
      session.start()
      drive(session)
      await settle(SPLASH_CEILING_MS + SPLASH_HOLD_MS)
      expect(session.getSnapshot().visible).toBe(false)
    },
  )
})
