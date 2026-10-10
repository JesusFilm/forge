import { INITIAL_REEL_STATE, reelReducer } from "./reelState"
import {
  classifyRemoteEvent,
  shouldAutoStartShowcase,
} from "./exitClassification"

describe("classifyRemoteEvent — deliberate presses exit (R12)", () => {
  it.each([
    "up",
    "down",
    "left",
    "right",
    "select",
    "longSelect",
    "playPause",
    "longPlayPause",
    "menu",
  ])("exits on %s", (eventType) => {
    expect(classifyRemoteEvent({ eventType })).toBe("exit")
  })

  // A held direction fires ONLY the long variant: the tap and long-press recognizers
  // share a press type with no requireGestureRecognizerToFail, so the tap fails.
  it.each(["longUp", "longDown", "longLeft", "longRight"])(
    "exits on %s — a hold never delivers the short press that would have exited",
    (eventType) => {
      expect(classifyRemoteEvent({ eventType })).toBe("exit")
    },
  )

  // Denylist, not allowlist: R12 says ANY deliberate press, and an allowlist silently
  // drops the media/page keys that only some remotes carry.
  it.each([
    "playPause",
    "fastForward",
    "rewind",
    "stop",
    "next",
    "pageUp",
    "info",
  ])("exits on the unlisted hardware key %s", (eventType) => {
    expect(classifyRemoteEvent({ eventType })).toBe("exit")
  })
})

describe("classifyRemoteEvent — touchpad noise never exits (AE8)", () => {
  it.each(["pan", "panBegin", "panEnd"])("ignores %s", (eventType) => {
    expect(classifyRemoteEvent({ eventType })).toBe("ignore")
  })

  it.each(["swipeLeft", "swipeRight", "swipeUp", "swipeDown"])(
    "ignores %s — a resting finger on the Siri remote arrives as a swipe",
    (eventType) => {
      expect(classifyRemoteEvent({ eventType })).toBe("ignore")
    },
  )

  it.each(["focus", "blur"])("ignores the synthetic event %s", (eventType) => {
    expect(classifyRemoteEvent({ eventType })).toBe("ignore")
  })

  it.each([null, undefined, {}, { eventType: null }, { eventType: "" }])(
    "ignores the malformed event %p",
    (event) => {
      expect(classifyRemoteEvent(event)).toBe("ignore")
    },
  )
})

describe("exit is idempotent (Android and tvOS both double-deliver select)", () => {
  it("produces ONE exit transition for two select events in the same window", () => {
    let state = INITIAL_REEL_STATE
    const transitions: string[] = []

    for (const event of [{ eventType: "select" }, { eventType: "select" }]) {
      if (classifyRemoteEvent(event) !== "exit") continue
      const next = reelReducer(state, { type: "exit" })
      if (next !== state) transitions.push(next.phase)
      state = next
    }

    expect(transitions).toEqual(["exited"])
  })
})

describe("shouldAutoStartShowcase — fires once per launch, only when enabled (AE3)", () => {
  const armed = {
    hydrated: true,
    autoStartEnabled: true,
    alreadyStarted: false,
    activePath: "/",
  }

  it("starts the showcase when auto-start is on and Home is the active route", () => {
    expect(shouldAutoStartShowcase(armed)).toBe(true)
  })

  it("does not start when auto-start is off", () => {
    expect(shouldAutoStartShowcase({ ...armed, autoStartEnabled: false })).toBe(
      false,
    )
  })

  // The pre-hydration default is `false`; firing on it would read the toggle as off
  // for every user who has it on.
  it("waits for prefs to hydrate rather than trusting the default", () => {
    expect(shouldAutoStartShowcase({ ...armed, hydrated: false })).toBe(false)
  })

  it("does not start twice in one launch", () => {
    expect(shouldAutoStartShowcase({ ...armed, alreadyStarted: true })).toBe(
      false,
    )
  })

  // A deep link puts its route above Home; auto-starting would yank the viewer off
  // the thing they asked for.
  it.each(["/watch/the-birth-of-jesus", "/settings", "/showcase"])(
    "does not start while %s is the active route",
    (activePath) => {
      expect(shouldAutoStartShowcase({ ...armed, activePath })).toBe(false)
    },
  )

  it("does not start before the router reports a route", () => {
    expect(shouldAutoStartShowcase({ ...armed, activePath: null })).toBe(false)
  })
})
