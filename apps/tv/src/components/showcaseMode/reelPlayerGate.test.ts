import { isAppStateForeground } from "../watch/videoBackdropGate"
import { computeReelPlayerGate } from "./reelPlayerGate"

// Steady state: the reel is playing the excerpt it wants (confirmed === target).
// Every case below perturbs exactly one axis away from it, because that is the
// only combination in which all six inputs are live.
const playing = {
  screenFocused: true,
  appForeground: true,
  active: true,
  hasStream: true,
  videoReady: true,
  excerptToken: 7,
  confirmedToken: 7,
}

describe("computeReelPlayerGate — the swap window (R11/KTD-3)", () => {
  it("covers with the poster while a swap is in flight — the reel targets an excerpt the player has not confirmed", () => {
    expect(computeReelPlayerGate({ ...playing, excerptToken: 8 })).toEqual({
      shouldPlay: true,
      shouldMountVideo: true,
      posterVisible: true,
      swapInFlight: true,
    })
  })

  it("lifts the poster once THIS token's playback is confirmed", () => {
    expect(computeReelPlayerGate(playing).posterVisible).toBe(false)
  })

  it("covers before the first excerpt is ever confirmed", () => {
    expect(
      computeReelPlayerGate({ ...playing, confirmedToken: null }).swapInFlight,
    ).toBe(true)
  })

  it("keeps playing THROUGH a swap — pausing would stall the load that ends it", () => {
    expect(
      computeReelPlayerGate({ ...playing, excerptToken: 8 }).shouldPlay,
    ).toBe(true)
  })

  it("never lifts the poster on a stale confirmation from an earlier excerpt", () => {
    // A late native emit for token 6 must not uncover token 8's unloaded source.
    expect(
      computeReelPlayerGate({ ...playing, excerptToken: 8, confirmedToken: 6 })
        .posterVisible,
    ).toBe(true)
  })
})

describe("computeReelPlayerGate — decode slot lifecycle (R18)", () => {
  it("mounts + plays when the route is active and the app is foreground", () => {
    expect(computeReelPlayerGate(playing)).toEqual({
      shouldPlay: true,
      shouldMountVideo: true,
      posterVisible: false,
      swapInFlight: false,
    })
  })

  it("unmounts the VideoView on nav-away — a paused view still holds a tvOS decode slot", () => {
    expect(computeReelPlayerGate({ ...playing, screenFocused: false })).toEqual(
      {
        shouldPlay: false,
        shouldMountVideo: false,
        posterVisible: true,
        swapInFlight: false,
      },
    )
  })

  it("unmounts + silences on background (R18)", () => {
    expect(computeReelPlayerGate({ ...playing, appForeground: false })).toEqual(
      {
        shouldPlay: false,
        shouldMountVideo: false,
        posterVisible: true,
        swapInFlight: false,
      },
    )
  })

  it("covers with the poster whenever the video is unmounted, even mid-excerpt — an uncovered gap shows bare screen background", () => {
    expect(
      computeReelPlayerGate({ ...playing, appForeground: false }).posterVisible,
    ).toBe(true)
  })

  it("does not mount without a stream", () => {
    expect(computeReelPlayerGate({ ...playing, hasStream: false })).toEqual({
      shouldPlay: false,
      shouldMountVideo: false,
      posterVisible: true,
      swapInFlight: false,
    })
  })

  it("does not mount before the first frame is renderable — the black-flash window", () => {
    expect(
      computeReelPlayerGate({ ...playing, videoReady: false }).shouldMountVideo,
    ).toBe(false)
  })
})

describe("computeReelPlayerGate — silent phases (R8/R10)", () => {
  // enterChapterAt bumps the token AND sets phase=chapterCard, so the next
  // excerpt's stream lands DURING the card. Playing then would bleed audio behind
  // an opaque card and drop the viewer ~5s into the excerpt when it lifts.
  it("stays mounted but silent while a chapter card or interstitial is up (active=false)", () => {
    expect(computeReelPlayerGate({ ...playing, active: false })).toEqual({
      shouldPlay: false,
      shouldMountVideo: true,
      posterVisible: false,
      swapInFlight: false,
    })
  })

  it("loads the next excerpt silently behind the chapter card — the card IS the buffer window (R17)", () => {
    const duringCard = computeReelPlayerGate({
      ...playing,
      active: false,
      excerptToken: 8,
    })
    expect(duringCard.shouldMountVideo).toBe(true)
    expect(duringCard.shouldPlay).toBe(false)
    expect(duringCard.posterVisible).toBe(true)
  })
})

describe("computeReelPlayerGate — U7's rebuffer seam (KTD-9)", () => {
  it("reports swapInFlight so a language-rotation swap is not counted as a rebuffer", () => {
    expect(
      computeReelPlayerGate({ ...playing, excerptToken: 8 }).swapInFlight,
    ).toBe(true)
    expect(computeReelPlayerGate(playing).swapInFlight).toBe(false)
  })
})

// ReelPlayer derives appForeground through isAppStateForeground, so the teardown
// rule only holds end-to-end if the composition does. Asserting "background"
// alone passes for the buggy `=== "active"` too — only "inactive" separates them.
describe("AppState composition — the teardown gate (tvOS)", () => {
  it('keeps the reel mounted through a transient "inactive" blip (Control Center, Siri)', () => {
    const gate = computeReelPlayerGate({
      ...playing,
      appForeground: isAppStateForeground("inactive"),
    })
    expect(gate.shouldMountVideo).toBe(true)
    expect(gate.shouldPlay).toBe(true)
  })

  it('releases the decode slot on genuine "background" (R18)', () => {
    expect(
      computeReelPlayerGate({
        ...playing,
        appForeground: isAppStateForeground("background"),
      }).shouldMountVideo,
    ).toBe(false)
  })

  it('plays while "active"', () => {
    expect(
      computeReelPlayerGate({
        ...playing,
        appForeground: isAppStateForeground("active"),
      }).shouldPlay,
    ).toBe(true)
  })
})
