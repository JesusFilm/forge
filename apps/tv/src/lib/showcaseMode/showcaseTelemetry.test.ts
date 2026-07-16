import { createVideoQoeSession } from "../videoQoe"
import {
  SHOWCASE_EXIT_ACTION,
  SHOWCASE_FIRST_FRAME_TIMING,
  SHOWCASE_START_ACTION,
  createShowcaseOnceLatch,
  hasShowcaseStarted,
  resolveShowcaseExitReason,
  resolveShowcaseStartPath,
  resolveShowcaseStartSource,
  SHOWCASE_AUTO_SOURCE,
  shouldCountReelRebuffer,
} from "./showcaseTelemetry"

// ── createShowcaseOnceLatch ─────────────────────────────────────────

describe("createShowcaseOnceLatch", () => {
  it("fires once per mount instance and never again", () => {
    const latch = createShowcaseOnceLatch()

    expect(latch.claim()).toBe(true)
    expect(latch.claim()).toBe(false)
    expect(latch.claim()).toBe(false)
  })

  it("re-arms on remount: a fresh latch fires again", () => {
    const firstMount = createShowcaseOnceLatch()
    firstMount.claim()

    const remount = createShowcaseOnceLatch()

    expect(remount.claim()).toBe(true)
  })

  it("keeps latches independent, so the exit report cannot consume the first-frame timing", () => {
    const firstFrame = createShowcaseOnceLatch()
    const exit = createShowcaseOnceLatch()

    expect(firstFrame.claim()).toBe(true)

    expect(exit.claim()).toBe(true)
  })

  it("reports one showcase_exit when a single press double-delivers the exit callback", () => {
    // Android dispatches key-down AND key-up, and tvOS's focused Pressable fires
    // onPress alongside the global select HWEvent — one press, two callbacks.
    const latch = createShowcaseOnceLatch()
    const reported: string[] = []
    const onExit = () => {
      if (!latch.claim()) return
      reported.push(SHOWCASE_EXIT_ACTION)
    }

    onExit()
    onExit()

    expect(reported).toEqual(["showcase_exit"])
  })

  it("drops the unmount exit report after a press already reported one", () => {
    const latch = createShowcaseOnceLatch()
    const reported: string[] = []
    const report = (reason: string) => {
      if (!latch.claim()) return
      reported.push(reason)
    }

    report("press")
    report("navigation")

    expect(reported).toEqual(["press"])
  })
})

// ── Action + timing names ───────────────────────────────────────────

describe("telemetry names", () => {
  it("names the actions and timing as constants carrying no CMS text", () => {
    expect(SHOWCASE_START_ACTION).toBe("showcase_start")
    expect(SHOWCASE_EXIT_ACTION).toBe("showcase_exit")
    expect(SHOWCASE_FIRST_FRAME_TIMING).toBe("showcase_first_frame")
  })
})

// ── hasShowcaseStarted ──────────────────────────────────────────────

describe("hasShowcaseStarted", () => {
  it("waits while the queue is still resolving", () => {
    expect(hasShowcaseStarted("resolving")).toBe(false)
  })

  it("starts once the reel presents content on any path", () => {
    expect(hasShowcaseStarted("chapterCard")).toBe(true)
    expect(hasShowcaseStarted("excerpt")).toBe(true)
    expect(hasShowcaseStarted("interstitial")).toBe(true)
  })

  it("counts the stills floor as a start — a degraded reel is still a session", () => {
    expect(hasShowcaseStarted("stills")).toBe(true)
  })

  it("never starts for a press that exits during the resolving window", () => {
    expect(hasShowcaseStarted("exited")).toBe(false)
  })
})

// ── resolveShowcaseStartPath ────────────────────────────────────────

describe("resolveShowcaseStartPath", () => {
  it("names the curated reel when the Showcase Experience supplied the queue", () => {
    expect(resolveShowcaseStartPath({ kind: "curated" })).toBe("curated")
  })

  it("names the fallback reel when the Home pool composed the queue", () => {
    expect(resolveShowcaseStartPath({ kind: "fallback" })).toBe("fallback")
  })

  it("names the stills floor when the ladder found nothing playable", () => {
    expect(resolveShowcaseStartPath(null)).toBe("stills")
    expect(resolveShowcaseStartPath(undefined)).toBe("stills")
  })
})

// ── resolveShowcaseStartSource ──────────────────────────────────────

describe("resolveShowcaseStartSource", () => {
  it("names auto only for the param the auto-start gate stamps (AE3)", () => {
    expect(resolveShowcaseStartSource(SHOWCASE_AUTO_SOURCE)).toBe("auto")
  })

  it("names manual when Settings pushed the route without the param", () => {
    expect(resolveShowcaseStartSource(undefined)).toBe("manual")
  })

  it("names manual for a deep link, which is not the app starting itself", () => {
    expect(resolveShowcaseStartSource(null)).toBe("manual")
    expect(resolveShowcaseStartSource("")).toBe("manual")
  })

  it("never claims auto from an unrecognized param value", () => {
    expect(resolveShowcaseStartSource("manual")).toBe("manual")
    expect(resolveShowcaseStartSource("AUTO")).toBe("manual")
    expect(resolveShowcaseStartSource("autostart")).toBe("manual")
  })

  it("reads the first value when the router repeats the param", () => {
    expect(resolveShowcaseStartSource([SHOWCASE_AUTO_SOURCE, "manual"])).toBe(
      "auto",
    )
    expect(resolveShowcaseStartSource(["manual", SHOWCASE_AUTO_SOURCE])).toBe(
      "manual",
    )
  })
})

// ── resolveShowcaseExitReason ───────────────────────────────────────

describe("resolveShowcaseExitReason", () => {
  it("reports press when a deliberate remote press ended the reel", () => {
    expect(
      resolveShowcaseExitReason({ exitedViaPress: true, appForeground: true }),
    ).toBe("press")
  })

  it("reports background when the session ended with the app backgrounded", () => {
    expect(
      resolveShowcaseExitReason({
        exitedViaPress: false,
        appForeground: false,
      }),
    ).toBe("background")
  })

  it("reports navigation when the route unmounted with no press, app foregrounded", () => {
    expect(
      resolveShowcaseExitReason({ exitedViaPress: false, appForeground: true }),
    ).toBe("navigation")
  })

  it("keeps press winning over background — a press as the app backgrounds is still the viewer leaving (R12)", () => {
    expect(
      resolveShowcaseExitReason({ exitedViaPress: true, appForeground: false }),
    ).toBe("press")
  })
})

// ── shouldCountReelRebuffer ─────────────────────────────────────────

describe("shouldCountReelRebuffer", () => {
  it("counts a stall on the excerpt the reel asked for and the player confirmed", () => {
    expect(shouldCountReelRebuffer({ confirmedToken: 4, targetToken: 4 })).toBe(
      true,
    )
  })

  it("does not count the initial load, before any frame has been confirmed", () => {
    expect(
      shouldCountReelRebuffer({ confirmedToken: null, targetToken: 1 }),
    ).toBe(false)
  })

  it("does not count a language-rotation swap still buffering its new source (KTD-9)", () => {
    expect(shouldCountReelRebuffer({ confirmedToken: 4, targetToken: 5 })).toBe(
      false,
    )
  })

  it("walks a swap: no rebuffer through the swap, then counts once the new excerpt settles", () => {
    const midSwap = shouldCountReelRebuffer({
      confirmedToken: 1,
      targetToken: 2,
    })
    const settled = shouldCountReelRebuffer({
      confirmedToken: 2,
      targetToken: 2,
    })

    expect([midSwap, settled]).toEqual([false, true])
  })
})

// ── Per-excerpt QoE lifecycle (the videoQoe seam ReelPlayer drives) ──

describe("per-excerpt QoE sessions", () => {
  it("yields one summary when a swap finalizes an excerpt the unmount also finalizes", () => {
    // ReelPlayer finalizes "ended" on every advance AND "abandoned" on unmount, both
    // unconditionally — whichever lands first must be the only summary emitted.
    const session = createVideoQoeSession({ contentId: "mux-1" })
    session.onFirstPlaying()

    const onAdvance = session.finalize("ended")
    const onUnmount = session.finalize("abandoned")

    expect(onAdvance).toMatchObject({ content_id: "mux-1", reason: "ended" })
    expect(onUnmount).toBeNull()
  })

  it("keys each excerpt's session on its own Mux playback id, and does not carry rebuffers across", () => {
    const first = createVideoQoeSession({ contentId: "mux-1" })
    first.onRebuffer()
    first.finalize("ended")

    const second = createVideoQoeSession({ contentId: "mux-2" })
    const summary = second.finalize("abandoned")

    expect(summary).toMatchObject({ content_id: "mux-2", rebuffer_count: 0 })
  })

  it("reports a null content_id rather than throwing when the dub carries no Mux id", () => {
    const session = createVideoQoeSession({ contentId: null })

    expect(session.finalize("ended")).toMatchObject({ content_id: null })
  })
})
