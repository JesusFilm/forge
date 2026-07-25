import {
  AUDIO_FADE_IN_MS,
  AUDIO_FADE_OUT_ARM_SECONDS,
  AUDIO_FADE_OUT_SECONDS,
  AUDIO_FADE_TICK_MS,
  crossfadeGainsAt,
  fadeOutVolumeAt,
  shouldArmFadeOut,
  shouldDriveFadeOut,
  volumeAtElapsed,
} from "./audioFade"

const win = (startSeconds: number, endSeconds: number) => ({
  startSeconds,
  endSeconds,
})

describe("volumeAtElapsed — the ramp", () => {
  it("starts at the from value and ends at the to value", () => {
    expect(
      volumeAtElapsed({ from: 1, to: 0, elapsedMs: 0, durationMs: 1000 }),
    ).toBe(1)
    expect(
      volumeAtElapsed({ from: 1, to: 0, elapsedMs: 1000, durationMs: 1000 }),
    ).toBe(0)
  })

  it("is linear across the span, both directions", () => {
    expect(
      volumeAtElapsed({ from: 1, to: 0, elapsedMs: 250, durationMs: 1000 }),
    ).toBeCloseTo(0.75)
    expect(
      volumeAtElapsed({ from: 0, to: 1, elapsedMs: 250, durationMs: 500 }),
    ).toBeCloseTo(0.5)
  })

  it("is monotonic — a fade never swells back up mid-ramp", () => {
    let previous = 1.1
    for (
      let elapsedMs = 0;
      elapsedMs <= 1000;
      elapsedMs += AUDIO_FADE_TICK_MS
    ) {
      const v = volumeAtElapsed({ from: 1, to: 0, elapsedMs, durationMs: 1000 })
      expect(v).toBeLessThanOrEqual(previous)
      previous = v
    }
    expect(previous).toBe(0)
  })

  // The timer can overshoot its last tick; the ramp must not invert past the target.
  it("clamps past the end of the span rather than overshooting", () => {
    expect(
      volumeAtElapsed({ from: 1, to: 0, elapsedMs: 5000, durationMs: 1000 }),
    ).toBe(0)
    expect(
      volumeAtElapsed({ from: 0, to: 1, elapsedMs: 5000, durationMs: 500 }),
    ).toBe(1)
  })

  it("never leaves expo-video's 0..1 volume range", () => {
    for (const args of [
      { from: 2, to: 0, elapsedMs: 0, durationMs: 1000 },
      { from: -1, to: 1, elapsedMs: 0, durationMs: 1000 },
      { from: 0, to: 5, elapsedMs: 1000, durationMs: 1000 },
      { from: 1, to: 0, elapsedMs: -50, durationMs: 1000 },
    ]) {
      const v = volumeAtElapsed(args)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it("snaps to the target for a zero or invalid duration rather than dividing by it", () => {
    expect(
      volumeAtElapsed({ from: 1, to: 0, elapsedMs: 0, durationMs: 0 }),
    ).toBe(0)
    expect(
      volumeAtElapsed({
        from: 1,
        to: 0,
        elapsedMs: 10,
        durationMs: Number.NaN,
      }),
    ).toBe(0)
  })
})

describe("fadeOutVolumeAt — keyed to media time, not wall time", () => {
  it("holds at full until the final second, which is what makes the early arm free", () => {
    expect(fadeOutVolumeAt({ remainingSeconds: 2 })).toBe(1)
    expect(fadeOutVolumeAt({ remainingSeconds: 1.5 })).toBe(1)
    expect(fadeOutVolumeAt({ remainingSeconds: 1 })).toBe(1)
  })

  it("ramps linearly across the last second and lands on silence at the end", () => {
    expect(fadeOutVolumeAt({ remainingSeconds: 0.75 })).toBeCloseTo(0.75)
    expect(fadeOutVolumeAt({ remainingSeconds: 0.5 })).toBeCloseTo(0.5)
    expect(fadeOutVolumeAt({ remainingSeconds: 0 })).toBe(0)
  })

  it("stays silent past the end rather than inverting", () => {
    expect(fadeOutVolumeAt({ remainingSeconds: -0.5 })).toBe(0)
    expect(fadeOutVolumeAt({ remainingSeconds: -30 })).toBe(0)
  })

  // Whichever sample arms the fade, the curve is a function of what's LEFT, so it
  // still reaches exactly 0 at the end. This is what makes a drifting clock safe.
  it("lands on silence at the end from any arming point", () => {
    for (const armedAt of [2, 1.95, 1.4, 1.05, 0.95, 0.5]) {
      expect(fadeOutVolumeAt({ remainingSeconds: armedAt })).toBeGreaterThan(0)
      expect(fadeOutVolumeAt({ remainingSeconds: 0 })).toBe(0)
    }
  })

  it("treats a non-finite clock as not fading rather than silencing the reel", () => {
    expect(fadeOutVolumeAt({ remainingSeconds: Number.NaN })).toBe(1)
    expect(
      fadeOutVolumeAt({ remainingSeconds: Number.POSITIVE_INFINITY }),
    ).toBe(1)
  })
})

describe("shouldArmFadeOut — R6 window end", () => {
  it("arms with a whole spare interval before the end, not one exact sample", () => {
    const w = win(0, 25)
    expect(shouldArmFadeOut({ currentTime: 22.9, window: w })).toBe(false)
    expect(shouldArmFadeOut({ currentTime: 23, window: w })).toBe(true)
    expect(shouldArmFadeOut({ currentTime: 24, window: w })).toBe(true)
    expect(shouldArmFadeOut({ currentTime: 25, window: w })).toBe(true)
  })

  // THE ANDROID CASE. Only tvOS reports on an exact 1s media lattice; Android's
  // postDelayed clock drifts to OVER 1s per sample, so a one-interval arming window
  // gets stepped over entirely and the fade never runs. Sweep a drifting clock across
  // every phase and assert some sample still arms with a full second of media left —
  // an integer-stepped grid asserts the tvOS lattice and cannot catch this.
  it("still arms on a drifting, over-1s clock at every phase offset", () => {
    for (const period of [1.01, 1.05, 1.2]) {
      for (let phase = 0; phase < period; phase += 0.05) {
        const w = win(0, 25)
        let armedWithRemaining: number | null = null
        for (let t = phase; t <= 25; t += period) {
          if (
            armedWithRemaining == null &&
            shouldArmFadeOut({ currentTime: t, window: w })
          ) {
            armedWithRemaining = w.endSeconds - t
          }
        }
        expect(armedWithRemaining).not.toBeNull()
        // Armed while there is still audible content left to fade, never at the end.
        expect(armedWithRemaining!).toBeGreaterThan(0)
        // And the curve is still at full volume there, so no audio is skipped.
        expect(
          fadeOutVolumeAt({ remainingSeconds: armedWithRemaining! }),
        ).toBeGreaterThan(0)
      }
    }
  })

  it("leaves a long-form excerpt alone until its own window end nears", () => {
    const w = win(540, 580)
    expect(shouldArmFadeOut({ currentTime: 540, window: w })).toBe(false)
    expect(shouldArmFadeOut({ currentTime: 577.9, window: w })).toBe(false)
    expect(shouldArmFadeOut({ currentTime: 578, window: w })).toBe(true)
  })

  // A degenerate window would otherwise arm at a negative time and never fire.
  it("arms from the first frame when the window is shorter than the arming lead", () => {
    expect(shouldArmFadeOut({ currentTime: 0, window: win(0, 1) })).toBe(true)
  })

  it("ignores a non-finite clock rather than arming on it", () => {
    const w = win(0, 25)
    expect(shouldArmFadeOut({ currentTime: Number.NaN, window: w })).toBe(false)
    // Infinity is the load-bearing case: a NaN comparison is already false, so it is
    // the only input that fails if the isFinite guard is deleted.
    expect(
      shouldArmFadeOut({ currentTime: Number.POSITIVE_INFINITY, window: w }),
    ).toBe(false)
  })
})

describe("fade timings", () => {
  it("keeps the in-fade on the poster's curve", () => {
    expect(AUDIO_FADE_IN_MS).toBe(500)
  })

  // The arm must clear more than one nominal timeUpdate interval, or a drifting
  // Android clock steps over the whole window (see the drift case above).
  it("arms at least one spare interval before the fade itself begins", () => {
    expect(AUDIO_FADE_OUT_SECONDS).toBe(1)
    expect(AUDIO_FADE_OUT_ARM_SECONDS).toBeGreaterThanOrEqual(
      AUDIO_FADE_OUT_SECONDS + 1,
    )
  })

  it("ticks fast enough to interpolate the fade rather than step it", () => {
    expect(AUDIO_FADE_TICK_MS).toBeLessThan(
      (AUDIO_FADE_OUT_SECONDS * 1000) / 10,
    )
  })
})

describe("shouldDriveFadeOut — the token-keyed re-arm gate", () => {
  const w = win(0, 25)
  const inWindow = 24 // past endSeconds - ARM(2)

  it("arms once for a fresh token that has entered the window", () => {
    expect(
      shouldDriveFadeOut({
        armedForToken: null,
        loadedToken: 2,
        positionMoved: true,
        currentTime: inWindow,
        window: w,
      }),
    ).toBe(true)
  })

  it("does not arm before the window, however the latch stands", () => {
    expect(
      shouldDriveFadeOut({
        armedForToken: null,
        loadedToken: 2,
        positionMoved: true,
        currentTime: 22.9,
        window: w,
      }),
    ).toBe(false)
  })

  it("re-bases on a moved sample once armed, so a drifting clock stays on curve", () => {
    expect(
      shouldDriveFadeOut({
        armedForToken: 2,
        loadedToken: 2,
        positionMoved: true,
        currentTime: inWindow,
        window: w,
      }),
    ).toBe(true)
  })

  it("does NOT re-base on a stalled sample — a repeated position must not swell volume", () => {
    expect(
      shouldDriveFadeOut({
        armedForToken: 2,
        loadedToken: 2,
        positionMoved: false,
        currentTime: inWindow,
        window: w,
      }),
    ).toBe(false)
  })

  // THE REGRESSION. The outgoing stream keeps emitting timeUpdate past its own end;
  // one such late event set a bare boolean latch AFTER the swap reset it, so the next
  // excerpt found it already armed and never faded. Keying on the token makes a stale
  // latch (armed for the OLD token) irrelevant — the new token arms on its own merits.
  it("arms the new excerpt even when a stale latch from the outgoing token survives", () => {
    expect(
      shouldDriveFadeOut({
        armedForToken: 1, // late latch from the excerpt that just ended
        loadedToken: 2, // the excerpt now playing
        positionMoved: false,
        currentTime: inWindow,
        window: w,
      }),
    ).toBe(true)
  })
})

describe("crossfadeGainsAt — hop language crossfade", () => {
  it("starts fully on the outgoing dub and ends fully on the incoming", () => {
    expect(crossfadeGainsAt({ elapsedMs: 0, durationMs: 500 })).toEqual({
      outgoing: 1,
      incoming: 0,
    })
    const end = crossfadeGainsAt({ elapsedMs: 500, durationMs: 500 })
    expect(end.outgoing).toBeCloseTo(0, 6)
    expect(end.incoming).toBeCloseTo(1, 6)
  })

  it("keeps constant total power throughout, so there is no midpoint loudness dip", () => {
    for (const elapsedMs of [0, 60, 125, 250, 375, 440, 500]) {
      const g = crossfadeGainsAt({ elapsedMs, durationMs: 500 })
      // Equal-power: the two gains' SQUARES sum to 1 at every instant (no gap, no dip).
      expect(g.outgoing ** 2 + g.incoming ** 2).toBeCloseTo(1, 6)
      // And both tracks are audible together through the whole crossfade — never silence.
      if (elapsedMs > 0 && elapsedMs < 500) {
        expect(g.outgoing).toBeGreaterThan(0)
        expect(g.incoming).toBeGreaterThan(0)
      }
    }
  })

  it("moves monotonically — outgoing only falls, incoming only rises", () => {
    let prevOut = Infinity
    let prevIn = -Infinity
    for (let elapsedMs = 0; elapsedMs <= 500; elapsedMs += 50) {
      const g = crossfadeGainsAt({ elapsedMs, durationMs: 500 })
      expect(g.outgoing).toBeLessThanOrEqual(prevOut + 1e-9)
      expect(g.incoming).toBeGreaterThanOrEqual(prevIn - 1e-9)
      prevOut = g.outgoing
      prevIn = g.incoming
    }
  })

  it("clamps out-of-range and degenerate inputs to the endpoints without throwing", () => {
    expect(crossfadeGainsAt({ elapsedMs: -100, durationMs: 500 })).toEqual({
      outgoing: 1,
      incoming: 0,
    })
    const past = crossfadeGainsAt({ elapsedMs: 999, durationMs: 500 })
    expect(past.outgoing).toBeCloseTo(0, 6)
    expect(past.incoming).toBeCloseTo(1, 6)
    // Non-positive / non-finite duration collapses straight to the incoming.
    expect(crossfadeGainsAt({ elapsedMs: 10, durationMs: 0 })).toEqual({
      outgoing: 0,
      incoming: 1,
    })
  })
})
