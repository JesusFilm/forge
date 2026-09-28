// The verse change (owner, 2026-09-28): a fade with a small move. A newer
// verse interrupts the running change, and the verse on screen leaves from
// where it is, so the change never finishes a verse the thumb has left.
import {
  advanceStage,
  changeReady,
  changeTiming,
  curveAt,
  endChange,
  endWait,
  forceChange,
  initialStage,
  interruptChange,
  needsInterrupt,
  reportFit,
  slideCurves,
  stageStill,
  VERSE_SCRUB_SLIDE_MS,
  VERSE_SLIDE_MS,
  VERSE_SLIDE_SHIFT,
  type StageInput,
  type StageVerse,
  type VerseStage,
} from "../verseStage"

type View = { text: string; selected: boolean }
type Fit = { size: number }
type Stage = VerseStage<View, Fit>

const sameView = (a: View, b: View) =>
  a.text === b.text && a.selected === b.selected
const sameFit = (a: Fit, b: Fit) => a.size === b.size

function verse(index: number, chapterKey = "BSB:JHN.3"): StageVerse<View> {
  return {
    key: `${chapterKey}:${index}`,
    chapterKey,
    index,
    view: { text: `verse ${index}`, selected: false },
  }
}

function input(overrides: Partial<StageInput<View>>): StageInput<View> {
  return {
    live: null,
    loading: false,
    slide: null,
    scrubbing: false,
    reduceMotion: false,
    ...overrides,
  }
}

/** Runs the render step until it settles, as React re-renders on a change. */
function advance(stage: Stage, next: StageInput<View>): Stage {
  let current = stage
  for (let pass = 0; pass < 4; pass += 1) {
    const after = advanceStage(current, next, sameView)
    if (after === current) return current
    current = after
  }
  throw new Error("the stage did not settle")
}

/** A stage showing `at`, with its fit reported. */
function showing(at: StageVerse<View>, slideId = 0): Stage {
  const first = input({
    live: at,
    slide: slideId ? { id: slideId, direction: "forward" } : null,
  })
  return reportFit(
    initialStage<View, Fit>(first),
    at.key,
    { size: 30 },
    sameFit,
  )
}

const measured = (stage: Stage) =>
  reportFit(stage, stage.shown!.key, { size: 28 }, sameFit)

describe("a move", () => {
  it("starts a change from the shown verse, at rest, to the new verse", () => {
    const stage = advance(
      showing(verse(16)),
      input({ live: verse(17), slide: { id: 1, direction: "forward" } }),
    )
    expect(stage.change).toMatchObject({
      pace: "move",
      direction: "forward",
      from: {
        verse: { key: verse(16).key },
        fit: { size: 30 },
        opacity: 1,
        x: 0,
        y: 0,
      },
    })
    expect(stage.shown?.key).toBe(verse(17).key)
    expect(changeTiming(stage.change!)).toEqual({
      duration: VERSE_SLIDE_MS,
      split: 0.5,
    })
    expect(changeReady(stage)).toBe(false)
    expect(changeReady(measured(stage))).toBe(true)
  })

  it("runs after a short wait when the new verse never reports its fit", () => {
    const stage = advance(
      showing(verse(16)),
      input({ live: verse(17), slide: { id: 1, direction: "forward" } }),
    )
    expect(changeReady(forceChange(stage, stage.change!.id))).toBe(true)
  })

  it("changes in place for a jump, a chapter swipe, or a new translation", () => {
    const stage = advance(showing(verse(16)), input({ live: verse(7) }))
    expect(stage.change).toBeNull()
    expect(stage.shown?.key).toBe(verse(7).key)
  })

  it("changes in place when the old verse never reported its fit", () => {
    const first = initialStage<View, Fit>(input({ live: verse(16) }))
    const stage = advance(
      first,
      input({ live: verse(17), slide: { id: 1, direction: "forward" } }),
    )
    expect(stage.change).toBeNull()
    expect(stage.shown?.key).toBe(verse(17).key)
  })

  it("changes in place with Reduce Motion on", () => {
    const stage = advance(
      showing(verse(16)),
      input({
        live: verse(17),
        slide: { id: 1, direction: "forward" },
        reduceMotion: true,
      }),
    )
    expect(stage.change).toBeNull()
    expect(stage.shown?.key).toBe(verse(17).key)
  })

  it("does not count the move that was there at the first render", () => {
    const stage = advance(
      showing(verse(16), 4),
      input({ live: verse(16), slide: { id: 4, direction: "forward" } }),
    )
    expect(stage.change).toBeNull()
    expect(stage.waiting).toBeNull()
  })
})

describe("a scrub", () => {
  const scrubTo = (stage: Stage, at: StageVerse<View>) =>
    advance(stage, input({ live: at, scrubbing: true }))

  /** 5 -> 6 is running with 6 measured; the thumb has moved on to `next`. */
  function running(next: StageVerse<View> = verse(7)): Stage {
    return scrubTo(measured(scrubTo(showing(verse(5)), verse(6))), next)
  }

  it("changes each verse at the scrub pace, in the thumb's direction", () => {
    const forward = scrubTo(showing(verse(5)), verse(9))
    expect(forward.change).toMatchObject({
      pace: "scrub",
      direction: "forward",
    })
    expect(changeTiming(forward.change!).duration).toBe(VERSE_SCRUB_SLIDE_MS)

    const back = scrubTo(showing(verse(9)), verse(5))
    expect(back.change).toMatchObject({ pace: "scrub", direction: "back" })
  })

  it("asks for an interrupt when the thumb leaves the verse coming in", () => {
    const stage = running()
    expect(stage.shown?.key).toBe(verse(6).key)
    expect(needsInterrupt(stage, verse(7))).toBe(true)
    expect(needsInterrupt(stage, verse(6))).toBe(false)
  })

  it("keeps the old verse fading when the new one has not shown yet", () => {
    // At 0.2 the old verse is still fading out and 6 is hidden.
    const stage = interruptChange(running(), verse(7), 0.2)
    expect(stage.shown?.key).toBe(verse(7).key)
    const from = stage.change!.from!
    expect(from.verse.key).toBe(verse(5).key)
    expect(from.opacity).toBeGreaterThan(0.5)
    expect(from.opacity).toBeLessThan(1)
    // It keeps moving up from where it was, not from its place.
    expect(from.y).toBeLessThan(0)
    expect(changeReady(stage)).toBe(true)
  })

  it("lets the new verse go from where it is once it shows", () => {
    // At 0.8 verse 6 is most of the way in; it leaves from there.
    const stage = interruptChange(running(), verse(7), 0.8)
    const from = stage.change!.from!
    expect(from.verse.key).toBe(verse(6).key)
    expect(from.fit).toEqual({ size: 28 })
    expect(from.opacity).toBeGreaterThan(0.5)
    expect(from.opacity).toBeLessThan(1)
    expect(from.y).toBeGreaterThan(0)
    expect(from.y).toBeLessThan(VERSE_SLIDE_SHIFT)
    expect(stage.change).toMatchObject({ pace: "scrub", direction: "forward" })
    expect(changeReady(stage)).toBe(true)
  })

  it("needs no still copy at the midpoint, where neither verse shows", () => {
    const stage = interruptChange(running(), verse(7), 0.5)
    expect(stage.change?.from).toBeNull()
    expect(stageStill(stage, { live: verse(7), loading: false })).toBeNull()
    expect(changeTiming(stage.change!)).toEqual({
      duration: VERSE_SCRUB_SLIDE_MS / 2,
      split: 0,
    })
  })

  it("fades a faint verse out sooner, so the next verse comes in sooner", () => {
    const faint = interruptChange(running(), verse(7), 0.45)
    const { duration, split } = changeTiming(faint.change!)
    expect(duration).toBeLessThan(VERSE_SCRUB_SLIDE_MS)
    expect(duration).toBeGreaterThan(VERSE_SCRUB_SLIDE_MS / 2)
    expect(split).toBeLessThan(0.5)
  })

  it("does not show a verse that never reported its fit", () => {
    // 6 never measured: at 0.8 it is still hidden, so 5 is the one that shows.
    const unmeasured = scrubTo(scrubTo(showing(verse(5)), verse(6)), verse(7))
    const stage = interruptChange(unmeasured, verse(7), 0.8)
    expect(stage.change?.from).toBeNull()
  })

  it("takes the direction from the leaving verse to the thumb's verse", () => {
    // 5 -> 8 runs and 8 shows; the thumb goes back to 6, then on to 7.
    let stage = measured(scrubTo(showing(verse(5)), verse(8)))
    stage = scrubTo(scrubTo(stage, verse(6)), verse(7))
    expect(interruptChange(stage, verse(7), 0.8).change?.direction).toBe("back")
    // Early on, 5 is the verse that shows, and 5 -> 7 is forward.
    expect(interruptChange(stage, verse(7), 0.1).change?.direction).toBe(
      "forward",
    )
  })

  it("does nothing more when the thumb comes back to the verse coming in", () => {
    let stage = running()
    stage = scrubTo(stage, verse(6))
    expect(needsInterrupt(stage, verse(6))).toBe(false)
    stage = advance(
      endChange(stage, stage.change!.id),
      input({ live: verse(6), scrubbing: true }),
    )
    expect(stage.change).toBeNull()
    expect(stage.waiting).toBeNull()
  })

  it("still interrupts for a verse that arrived just before the release", () => {
    let stage = running(verse(9))
    // The release saves verse 9: the same key, and no scrub any more.
    stage = advance(stage, input({ live: verse(9) }))
    expect(needsInterrupt(stage, verse(9))).toBe(true)
    stage = interruptChange(stage, verse(9), 0.3)
    expect(stage.change).toMatchObject({ pace: "scrub", direction: "forward" })
    expect(stage.shown?.key).toBe(verse(9).key)
  })

  it("ignores the end of a change that was interrupted", () => {
    const before = running()
    const oldId = before.change!.id
    const stage = interruptChange(before, verse(7), 0.3)
    expect(endChange(stage, oldId)).toBe(stage)
  })

  it("does not change on a release that keeps the verse", () => {
    const stage = advance(showing(verse(5)), input({ live: verse(5) }))
    expect(stage.change).toBeNull()
  })
})

describe("across a chapter load", () => {
  const FORWARD = { id: 1, direction: "forward" as const }
  const nextChapter = verse(0, "BSB:JHN.4")

  // The owner (2026-09-28): a chapter swipe slides sideways, and it holds
  // the old verse through the load like a verse move into a new chapter.
  it("slides a chapter swipe sideways, after the load", () => {
    const swipe = {
      id: 1,
      direction: "forward" as const,
      axis: "chapter" as const,
    }
    let stage = advance(
      showing(verse(16)),
      input({ live: null, loading: true, slide: swipe }),
    )
    expect(stageStill(stage, { live: null, loading: true })?.moving).toBe(false)
    stage = advance(stage, input({ live: nextChapter, slide: swipe }))
    expect(stage.change).toMatchObject({
      pace: "move",
      axis: "chapter",
      direction: "forward",
      from: { verse: { key: verse(16).key } },
    })
  })

  it("keeps a verse move vertical when it crosses into the next chapter", () => {
    const stage = advance(
      advance(
        showing(verse(36)),
        input({ live: null, loading: true, slide: FORWARD }),
      ),
      input({ live: nextChapter, slide: FORWARD }),
    )
    expect(stage.change?.axis).toBe("verse")
  })

  it("holds the old verse still while the chapter loads, then changes", () => {
    let stage = advance(
      showing(verse(36)),
      input({ live: null, loading: true, slide: FORWARD }),
    )
    expect(stageStill(stage, { live: null, loading: true })).toMatchObject({
      leaving: { verse: { key: verse(36).key }, opacity: 1, x: 0, y: 0 },
      moving: false,
    })

    stage = advance(stage, input({ live: nextChapter, slide: FORWARD }))
    expect(stage.change).toMatchObject({
      pace: "move",
      direction: "forward",
      from: { verse: { key: verse(36).key } },
    })
    // The still copy keeps its id, so it does not mount again.
    expect(stageStill(stage, { live: nextChapter, loading: false })?.id).toBe(
      stage.change!.id,
    )
  })

  it("lets the old verse go when the wait ends, and then changes in place", () => {
    let stage = advance(
      showing(verse(36)),
      input({ live: null, loading: true, slide: FORWARD }),
    )
    stage = endWait(stage)
    expect(stageStill(stage, { live: null, loading: true })).toBeNull()
    stage = advance(stage, input({ live: nextChapter, slide: FORWARD }))
    expect(stage.change).toBeNull()
  })

  it("ends the move when the load fails, so a later load changes in place", () => {
    let stage = advance(
      showing(verse(36)),
      input({ live: null, loading: true, slide: FORWARD }),
    )
    stage = advance(
      stage,
      input({ live: null, loading: false, slide: FORWARD }),
    )
    expect(stageStill(stage, { live: null, loading: false })).toBeNull()
    stage = advance(stage, input({ live: null, loading: true, slide: FORWARD }))
    expect(stageStill(stage, { live: null, loading: true })).toBeNull()
    stage = advance(stage, input({ live: nextChapter, slide: FORWARD }))
    expect(stage.change).toBeNull()
  })

  it("keeps the move's own direction across a book", () => {
    const stage = advance(
      advance(
        showing(verse(26, "BSB:GEN.50")),
        input({ live: null, loading: true, slide: FORWARD }),
      ),
      input({ live: verse(0, "BSB:EXO.1"), slide: FORWARD }),
    )
    expect(stage.change?.direction).toBe("forward")
  })
})

describe("the shown verse", () => {
  it("takes a new selection while its key stays", () => {
    const selected = {
      ...verse(16),
      view: { text: "verse 16", selected: true },
    }
    const stage = advance(showing(verse(16)), input({ live: selected }))
    expect(stage.shown?.view.selected).toBe(true)
  })
})

describe("slideCurves", () => {
  const AT_REST = { opacity: 1, x: 0, y: 0 }

  it("fades the old verse out and the new verse in, a few points each", () => {
    const { outgoing, incoming } = slideCurves("forward", "verse", AT_REST, 0.5)
    expect(curveAt(outgoing.opacity, 0)).toBe(1)
    expect(curveAt(outgoing.opacity, 1)).toBe(0)
    expect(curveAt(incoming.opacity, 0)).toBe(0)
    expect(curveAt(incoming.opacity, 1)).toBe(1)
    // Forward: the old verse moves up from its place, the new one up into it.
    expect(curveAt(outgoing.translateY, 0)).toBe(0)
    expect(curveAt(outgoing.translateY, 1)).toBe(-VERSE_SLIDE_SHIFT)
    expect(curveAt(incoming.translateY, 0)).toBe(VERSE_SLIDE_SHIFT)
    expect(curveAt(incoming.translateY, 1)).toBe(0)
  })

  it("moves both verses down for the verse before", () => {
    const { outgoing, incoming } = slideCurves("back", "verse", AT_REST, 0.5)
    expect(curveAt(outgoing.translateY, 1)).toBe(VERSE_SLIDE_SHIFT)
    expect(curveAt(incoming.translateY, 0)).toBe(-VERSE_SLIDE_SHIFT)
  })

  it("never shows the two verses together", () => {
    const { outgoing, incoming } = slideCurves("forward", "verse", AT_REST, 0.5)
    for (let p = 0; p <= 1; p += 0.01) {
      const both =
        curveAt(outgoing.opacity, p) > 0 && curveAt(incoming.opacity, p) > 0
      expect(both).toBe(false)
    }
  })

  it("starts a leaving verse from where it is, and moves it less", () => {
    const from = { opacity: 0.5, x: 0, y: 4 }
    const { outgoing } = slideCurves("forward", "verse", from, 0.3)
    expect(curveAt(outgoing.opacity, 0)).toBe(0.5)
    expect(curveAt(outgoing.translateY, 0)).toBe(4)
    expect(curveAt(outgoing.translateY, 0.3)).toBe(4 - VERSE_SLIDE_SHIFT / 2)
    expect(curveAt(outgoing.opacity, 0.3)).toBe(0)
  })

  // The owner (2026-09-28): a chapter swipe gets the same fade, sideways.
  it("moves both verses left for the next chapter, and holds them up and down", () => {
    const { outgoing, incoming } = slideCurves(
      "forward",
      "chapter",
      AT_REST,
      0.5,
    )
    expect(curveAt(outgoing.translateX, 0)).toBe(0)
    expect(curveAt(outgoing.translateX, 1)).toBe(-VERSE_SLIDE_SHIFT)
    expect(curveAt(incoming.translateX, 0)).toBe(VERSE_SLIDE_SHIFT)
    expect(curveAt(incoming.translateX, 1)).toBe(0)
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(curveAt(outgoing.translateY, p)).toBe(0)
      expect(curveAt(incoming.translateY, p)).toBe(0)
    }
    const back = slideCurves("back", "chapter", AT_REST, 0.5)
    expect(curveAt(back.outgoing.translateX, 1)).toBe(VERSE_SLIDE_SHIFT)
    expect(curveAt(back.incoming.translateX, 0)).toBe(-VERSE_SLIDE_SHIFT)
  })

  it("keeps a leaving verse's other offset still while it moves sideways", () => {
    const from = { opacity: 0.6, x: 0, y: -5 }
    const { outgoing } = slideCurves("forward", "chapter", from, 0.3)
    expect(curveAt(outgoing.translateY, 0)).toBe(-5)
    expect(curveAt(outgoing.translateY, 0.3)).toBe(-5)
    expect(curveAt(outgoing.translateX, 0.3)).toBeCloseTo(
      -VERSE_SLIDE_SHIFT * 0.6,
    )
  })

  it("gives the native driver increasing input ranges", () => {
    for (const split of [0, 0.2, 0.5]) {
      const curves = slideCurves("forward", "verse", AT_REST, split)
      for (const layer of [curves.outgoing, curves.incoming]) {
        for (const curve of [
          layer.opacity,
          layer.translateX,
          layer.translateY,
        ]) {
          const { inputRange } = curve
          expect(inputRange.length).toBe(curve.outputRange.length)
          for (let i = 1; i < inputRange.length; i += 1) {
            expect(inputRange[i]!).toBeGreaterThan(inputRange[i - 1]!)
          }
        }
      }
    }
  })
})
