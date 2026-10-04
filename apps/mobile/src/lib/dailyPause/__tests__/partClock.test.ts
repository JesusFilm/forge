// The clock of one devotional video part (U9, KTD8). Pure: every case gives
// the wall time and the media time by hand.
import { DEVOTIONALS, type PartRange } from "../devotionals"
import {
  PART_END_GUARD_SECONDS,
  PART_FRAME_WATCH_SECONDS,
  PART_REVEAL_LEAD_SECONDS,
  PART_START_BACKSTOP_MS,
  PART_TICK_SECONDS,
  partProgress,
  partStarted,
  partStopAt,
  partStopDue,
  projectClock,
  startBackstopDue,
  startClock,
  startGateOpen,
  tickClock,
  watchMode,
} from "../partClock"

/** Pharisee's film part, 12.2 s to 58.4 s. */
const FILM = DEVOTIONALS.pharisee.parts.film

describe("the projected media clock", () => {
  it("advances with wall time between ticks", () => {
    const clock = startClock(20, 1_000, true)
    expect(projectClock(clock, 1_000)).toBe(20)
    expect(projectClock(clock, 1_250)).toBeCloseTo(20.25, 6)
    expect(projectClock(clock, 3_000)).toBeCloseTo(22, 6)
  })

  it("rebases on a tick that moved", () => {
    const clock = startClock(20, 1_000, true)
    // The player reports a little less than the projection: the tick wins.
    const ticked = tickClock(clock, 20.2, 1_250)
    expect(projectClock(ticked, 1_250)).toBeCloseTo(20.2, 6)
    expect(projectClock(ticked, 1_500)).toBeCloseTo(20.45, 6)
  })

  it("keeps its base on a tick that did not move", () => {
    const clock = startClock(20, 1_000, true)
    const ticked = tickClock(clock, 20, 1_400)
    expect(ticked).toBe(clock)
    expect(projectClock(ticked, 1_500)).toBeCloseTo(20.5, 6)
  })

  it("stands still while paused", () => {
    const clock = startClock(20, 1_000, false)
    expect(projectClock(clock, 1_000)).toBe(20)
    expect(projectClock(clock, 60_000)).toBe(20)
    // A seek while paused moves the clock, and it still stands still.
    const seeked = tickClock(clock, 62.2, 61_000)
    expect(projectClock(seeked, 90_000)).toBe(62.2)
  })
})

describe("the guard stop", () => {
  it("stops the part the guard length before its end", () => {
    expect(partStopAt(FILM)).toBeCloseTo(FILM.endSec - PART_END_GUARD_SECONDS)
    expect(partStopDue(FILM.endSec - PART_END_GUARD_SECONDS, FILM)).toBe(true)
    expect(partStopDue(FILM.endSec - PART_END_GUARD_SECONDS - 0.02, FILM)).toBe(
      false,
    )
    expect(partStopDue(FILM.endSec + 1, FILM)).toBe(true)
  })

  it("hands over to a per-frame read in the last stretch before the stop", () => {
    const stopAt = partStopAt(FILM)
    expect(watchMode(FILM.startSec, FILM)).toBe("projected")
    expect(watchMode(stopAt - PART_FRAME_WATCH_SECONDS - 0.01, FILM)).toBe(
      "projected",
    )
    expect(watchMode(stopAt - PART_FRAME_WATCH_SECONDS, FILM)).toBe("frame")
    expect(watchMode(stopAt, FILM)).toBe("frame")
  })

  // A drifting tick (Android posts each tick a little late, and the error adds
  // up) must not carry the part past its stop before the frame watch begins.
  it("enters the frame watch before the stop at every tick period and phase", () => {
    const stopAt = partStopAt(FILM)
    const FRAME_MS = 1000 / 60
    const limitMs = (FILM.endSec - FILM.startSec + 5) * 1000
    for (const period of [PART_TICK_SECONDS, 0.26, 0.3, 0.5, 1.05]) {
      for (let phase = 0; phase < period; phase += 0.05) {
        let clock = startClock(FILM.startSec, 0, true)
        let nextTick = phase
        let frameWatchAt: number | null = null
        for (
          let wall = 0;
          wall <= limitMs && frameWatchAt == null;
          wall += FRAME_MS
        ) {
          const media = FILM.startSec + wall / 1000
          if (wall / 1000 >= nextTick) {
            clock = tickClock(clock, media, wall)
            nextTick += period
          }
          if (watchMode(projectClock(clock, wall), FILM) === "frame") {
            frameWatchAt = media
          }
        }
        expect(frameWatchAt).not.toBeNull()
        expect(stopAt - (frameWatchAt ?? stopAt)).toBeGreaterThan(1)
      }
    }
  })

  // Measured facts, not derived ones: the first frame of each skipped range in
  // the encoded files (Pharisee's card starts one frame before its film part's
  // end), and the latest stop on the simulator, past its stop point.
  const MEASURED_STOP_OVERRUN_SECONDS = 0.013
  const FIRST_SKIPPED_FRAME: readonly [string, PartRange, number][] = [
    ["Pharisee film", DEVOTIONALS.pharisee.parts.film, 1751 / 30],
    ["Pharisee teaching", DEVOTIONALS.pharisee.parts.teaching, 5475 / 30],
    ["Lamp film", DEVOTIONALS.lamp.parts.film, 785 / 30],
    ["Lamp teaching", DEVOTIONALS.lamp.parts.teaching, 3843 / 30],
  ]
  it.each(FIRST_SKIPPED_FRAME)(
    "stops the %s part at least one frame clear of its skipped range",
    (_name, part, firstSkippedSec) => {
      expect(
        partStopAt(part) + MEASURED_STOP_OVERRUN_SECONDS,
      ).toBeLessThanOrEqual(firstSkippedSec - 1 / 30)
    },
  )

  it("watches by frame for longer than one drifting tick plus a spare second", () => {
    expect(PART_TICK_SECONDS).toBe(0.25)
    expect(PART_FRAME_WATCH_SECONDS).toBeGreaterThanOrEqual(
      PART_TICK_SECONDS + 1,
    )
  })
})

describe("the start gate", () => {
  it("stays shut until the source is ready", () => {
    expect(
      startGateOpen({ ready: false, positionSec: FILM.startSec, part: FILM }),
    ).toBe(false)
    expect(
      startGateOpen({ ready: true, positionSec: FILM.startSec, part: FILM }),
    ).toBe(true)
  })

  it("stays shut until the position reaches the start", () => {
    // Before the seek lands, and at the end of the part before it.
    expect(startGateOpen({ ready: true, positionSec: 0, part: FILM })).toBe(
      false,
    )
    const teaching = DEVOTIONALS.pharisee.parts.teaching
    expect(
      startGateOpen({
        ready: true,
        positionSec: partStopAt(FILM),
        part: teaching,
      }),
    ).toBe(false)
    // A seek target read back through a float.
    expect(
      startGateOpen({ ready: true, positionSec: 12.199999, part: FILM }),
    ).toBe(true)
  })

  it("lifts the cover only after the media time moves past the start", () => {
    expect(partStarted(FILM.startSec, FILM)).toBe(false)
    expect(partStarted(FILM.startSec + 0.05, FILM)).toBe(false)
    expect(partStarted(FILM.startSec + PART_REVEAL_LEAD_SECONDS, FILM)).toBe(
      true,
    )
  })

  // Pharisee's teaching part opens on the last three frames of the fading
  // step card (62.2 s to 62.267 s), so the cover must hold past them.
  it("holds the cover over the step card's fade at the teaching start", () => {
    const teaching = DEVOTIONALS.pharisee.parts.teaching
    expect(teaching.startSec).toBe(62.2)
    expect(partStarted(62.267, teaching)).toBe(false)
    expect(partStarted(62.3, teaching)).toBe(true)
  })

  it("releases into the backstop when a part has not started in time", () => {
    expect(startBackstopDue(5_000, 5_000 + PART_START_BACKSTOP_MS - 1)).toBe(
      false,
    )
    expect(startBackstopDue(5_000, 5_000 + PART_START_BACKSTOP_MS)).toBe(true)
  })
})

describe("the part progress", () => {
  it("runs from the start to the stop", () => {
    const stopAt = partStopAt(FILM)
    expect(partProgress(0, FILM)).toBe(0)
    expect(partProgress(FILM.startSec, FILM)).toBe(0)
    expect(partProgress((FILM.startSec + stopAt) / 2, FILM)).toBeCloseTo(0.5)
    expect(partProgress(stopAt, FILM)).toBe(1)
    expect(partProgress(FILM.endSec + 5, FILM)).toBe(1)
  })
})
