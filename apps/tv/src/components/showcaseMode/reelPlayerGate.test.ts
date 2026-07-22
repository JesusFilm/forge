import { isAppStateForeground } from "../watch/videoBackdropGate"
import {
  WINDOW_SEEK_TOLERANCE_SECONDS,
  computeReelPlayerGate,
  needsWindowStartSeek,
} from "./reelPlayerGate"

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
  // Ordinary excerpt: a swap masks with the poster; only a preloaded flip stands it down.
  seamlessHopSwap: false,
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
    })
  })

  it("lifts the poster once THIS token's playback is confirmed", () => {
    expect(computeReelPlayerGate(playing).posterVisible).toBe(false)
  })

  it("covers before the first excerpt is ever confirmed", () => {
    expect(
      computeReelPlayerGate({ ...playing, confirmedToken: null }).posterVisible,
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

  it("grants the crossfade behind a chapter card too — ReelPlayer's covered branch owns the actual timing (delayed silent snap)", () => {
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

// A hop is the SAME footage in a different dub, and a preloaded flip keeps live
// frames on screen through the whole boundary — so the poster stands down for it.
// A preload MISS has a real load gap, and the poster masks it like any content cut.
describe("computeReelPlayerGate — the hop seam (KTD-5/R10)", () => {
  // Mid-plan flip: the reel targets the next dub, standby preloaded, not yet confirmed.
  const flipInFlight = { ...playing, excerptToken: 8, seamlessHopSwap: true }

  it("holds live frames — no poster — while a preloaded flip is in flight", () => {
    const gate = computeReelPlayerGate(flipInFlight)
    expect(gate.posterVisible).toBe(false)
    expect(gate.posterCrossfade).toBe(false)
    // The player keeps decoding through the swap, exactly as an ordinary swap does.
    expect(gate.shouldMountVideo).toBe(true)
    expect(gate.shouldPlay).toBe(true)
  })

  it("stays uncovered once the flipped hop is confirmed", () => {
    const gate = computeReelPlayerGate({ ...playing, seamlessHopSwap: true })
    expect(gate.posterVisible).toBe(false)
  })

  it("falls back to the poster when a flip coincides with an unmounted video", () => {
    // Backgrounded mid-hop: there is no live frame to hold, so cover with the poster.
    for (const unmounting of [
      { screenFocused: false },
      { appForeground: false },
      { videoReady: false },
    ]) {
      const gate = computeReelPlayerGate({
        ...flipInFlight,
        ...unmounting,
      })
      expect(gate.posterVisible).toBe(true)
    }
  })

  it("masks a preload-miss hop with the poster — seamlessHopSwap is false there", () => {
    // The ReelPlayer only claims seamless when the standby finished preloading this
    // exact stream (hopHandoff's resolveHopSwapMode); a miss is an ordinary cut.
    const gate = computeReelPlayerGate({ ...playing, excerptToken: 8 })
    expect(gate.posterVisible).toBe(true)
    expect(gate.posterCrossfade).toBe(true)
  })

  it("never covers on a stale confirmation while a flip is in flight", () => {
    const gate = computeReelPlayerGate({
      ...playing,
      excerptToken: 8,
      confirmedToken: 6,
      seamlessHopSwap: true,
    })
    expect(gate.posterVisible).toBe(false)
  })
})

// ── Dropped-seek self-heal (the shipped tvOS latent bug) ─────────────

describe("needsWindowStartSeek", () => {
  it("heals a dropped seek: the clock sits at the top of a mid-video window", () => {
    expect(needsWindowStartSeek({ currentTime: 0, startSeconds: 42 })).toBe(
      true,
    )
    expect(needsWindowStartSeek({ currentTime: 1.3, startSeconds: 42 })).toBe(
      true,
    )
  })

  it("never loops on a landed seek that settled keyframe-shy of the start", () => {
    expect(needsWindowStartSeek({ currentTime: 39.2, startSeconds: 42 })).toBe(
      false,
    )
    // Boundary: exactly the tolerance shy is treated as landed.
    expect(
      needsWindowStartSeek({
        currentTime: 42 - WINDOW_SEEK_TOLERANCE_SECONDS,
        startSeconds: 42,
      }),
    ).toBe(false)
  })

  it("never fires inside or past the window", () => {
    expect(needsWindowStartSeek({ currentTime: 50, startSeconds: 42 })).toBe(
      false,
    )
  })

  it("never fires for a from-zero window (short-form and fallback excerpts)", () => {
    expect(needsWindowStartSeek({ currentTime: 0, startSeconds: 0 })).toBe(
      false,
    )
  })

  it("heals a hop whose new dub reports 0 before its mid-video seek lands", () => {
    expect(needsWindowStartSeek({ currentTime: 0.4, startSeconds: 33 })).toBe(
      true,
    )
  })

  it("arms the readyToPlay re-seek for a deep sentence-aware window's dropped opener", () => {
    // ReelPlayer's readyToPlay branch reuses this classifier: a sentence-aware
    // English opener seeks to ~57s, and a dropped post-replaceAsync seek leaves the
    // clock near 0 — the fault itself arms the heal (it never suppresses it).
    expect(
      needsWindowStartSeek({ currentTime: 0.2, startSeconds: 56.76 }),
    ).toBe(true)
    expect(needsWindowStartSeek({ currentTime: 56, startSeconds: 56.76 })).toBe(
      false,
    )
  })
})
