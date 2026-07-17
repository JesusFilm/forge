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
  // Ordinary excerpt: a swap masks with the poster, never the hop dip.
  hopSwap: false,
}

// The watchdog arms on playIntended. If this ever collapsed into shouldPlay, the load
// half of the watchdog would go dead for the one fault it exists to catch — silently,
// because a never-starting source produces no failure of its own to notice.
describe("computeReelPlayerGate — what the watchdog arms on", () => {
  it("still intends playback for a source that has not reported itself ready", () => {
    const gate = computeReelPlayerGate({ ...playing, videoReady: false })
    expect(gate.shouldPlay).toBe(false)
    expect(gate.playIntended).toBe(true)
  })

  it("drops intent for each of the reel's own reasons to hold the player silent", () => {
    for (const paused of [
      { active: false },
      { screenFocused: false },
      { appForeground: false },
      { hasStream: false },
    ]) {
      expect(
        computeReelPlayerGate({ ...playing, ...paused }).playIntended,
      ).toBe(false)
    }
  })
})

describe("computeReelPlayerGate — the swap window (R11/KTD-3)", () => {
  it("covers with the poster while a swap is in flight — the reel targets an excerpt the player has not confirmed", () => {
    expect(computeReelPlayerGate({ ...playing, excerptToken: 8 })).toEqual({
      shouldPlay: true,
      shouldMountVideo: true,
      posterVisible: true,
      posterCrossfade: true,
      playIntended: true,
      swapInFlight: true,
      hopDipActive: false,
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

describe("computeReelPlayerGate — the poster dissolve (R11)", () => {
  it("dissolves in over the outgoing frame when an advance swap starts", () => {
    // The shell holds the outgoing stream mounted until its replacement resolves,
    // so there is a real frame underneath to blend away from.
    expect(
      computeReelPlayerGate({ ...playing, excerptToken: 8 }).posterCrossfade,
    ).toBe(true)
  })

  it("snaps instead of dissolving when the VideoView is unmounted — nothing beneath but bare background", () => {
    for (const unmounting of [
      { screenFocused: false },
      { appForeground: false },
      { hasStream: false },
      { videoReady: false },
    ]) {
      const gate = computeReelPlayerGate({
        ...playing,
        excerptToken: 8,
        ...unmounting,
      })
      expect(gate.posterVisible).toBe(true)
      expect(gate.posterCrossfade).toBe(false)
    }
  })

  it("snaps on the very first cover — there is no outgoing frame to dissolve from", () => {
    expect(
      computeReelPlayerGate({
        ...playing,
        confirmedToken: null,
        videoReady: false,
      }).posterCrossfade,
    ).toBe(false)
  })

  it("never claims a dissolve while the poster is down — an uncovered poster has nothing to fade", () => {
    expect(computeReelPlayerGate(playing).posterCrossfade).toBe(false)
  })

  it("dissolves behind a chapter card too: the card is opaque, but a bare gap under it is still a bug", () => {
    expect(
      computeReelPlayerGate({ ...playing, active: false, excerptToken: 8 })
        .posterCrossfade,
    ).toBe(true)
  })
})

describe("computeReelPlayerGate — decode slot lifecycle (R18)", () => {
  it("mounts + plays when the route is active and the app is foreground", () => {
    expect(computeReelPlayerGate(playing)).toEqual({
      shouldPlay: true,
      shouldMountVideo: true,
      posterVisible: false,
      posterCrossfade: false,
      playIntended: true,
      swapInFlight: false,
      hopDipActive: false,
    })
  })

  it("unmounts the VideoView on nav-away — a paused view still holds a tvOS decode slot", () => {
    expect(computeReelPlayerGate({ ...playing, screenFocused: false })).toEqual(
      {
        shouldPlay: false,
        shouldMountVideo: false,
        posterVisible: true,
        posterCrossfade: false,
        playIntended: false,
        swapInFlight: false,
        hopDipActive: false,
      },
    )
  })

  it("unmounts + silences on background (R18)", () => {
    expect(computeReelPlayerGate({ ...playing, appForeground: false })).toEqual(
      {
        shouldPlay: false,
        shouldMountVideo: false,
        posterVisible: true,
        posterCrossfade: false,
        playIntended: false,
        swapInFlight: false,
        hopDipActive: false,
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
      posterCrossfade: false,
      playIntended: false,
      swapInFlight: false,
      hopDipActive: false,
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
      posterCrossfade: false,
      playIntended: false,
      swapInFlight: false,
      hopDipActive: false,
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

// A hop is the SAME footage in a different dub. Covering it with the excerpt's static
// poster would read as a cut; instead the live video surface stays visible and a brief
// dip masks the swap (R10). The poster stays down; the dip takes over.
describe("computeReelPlayerGate — the hop seam (KTD-5/R10)", () => {
  // Mid-plan hop swap: the reel targets the next dub, not yet confirmed.
  const hopSwapInFlight = { ...playing, excerptToken: 8, hopSwap: true }

  it("holds the live frame — no poster — while a hop swap is in flight", () => {
    const gate = computeReelPlayerGate(hopSwapInFlight)
    expect(gate.posterVisible).toBe(false)
    expect(gate.posterCrossfade).toBe(false)
    expect(gate.hopDipActive).toBe(true)
    // The player keeps decoding through the swap, exactly as an ordinary swap does.
    expect(gate.shouldMountVideo).toBe(true)
    expect(gate.shouldPlay).toBe(true)
  })

  it("drops the dip once the hop is confirmed — the frame is the reel's own again", () => {
    const gate = computeReelPlayerGate({ ...playing, hopSwap: true })
    expect(gate.swapInFlight).toBe(false)
    expect(gate.hopDipActive).toBe(false)
    expect(gate.posterVisible).toBe(false)
  })

  it("falls back to the poster when a hop swap coincides with an unmounted video", () => {
    // Backgrounded mid-hop: there is no live frame to hold, so cover with the poster
    // and never claim a dip over bare screen background.
    for (const unmounting of [
      { screenFocused: false },
      { appForeground: false },
      { videoReady: false },
    ]) {
      const gate = computeReelPlayerGate({
        ...hopSwapInFlight,
        ...unmounting,
      })
      expect(gate.posterVisible).toBe(true)
      expect(gate.hopDipActive).toBe(false)
    }
  })

  it("keeps masking an ORDINARY excerpt swap with the poster, not the dip", () => {
    // The entry into the centerpiece (hop 0) and the exit past it are real content
    // cuts — hopSwap is false there, so the poster still owns those seams.
    const gate = computeReelPlayerGate({ ...playing, excerptToken: 8 })
    expect(gate.posterVisible).toBe(true)
    expect(gate.posterCrossfade).toBe(true)
    expect(gate.hopDipActive).toBe(false)
  })

  it("never lifts the dip on a stale confirmation from an earlier hop", () => {
    const gate = computeReelPlayerGate({
      ...playing,
      excerptToken: 8,
      confirmedToken: 6,
      hopSwap: true,
    })
    expect(gate.hopDipActive).toBe(true)
    expect(gate.posterVisible).toBe(false)
  })
})
