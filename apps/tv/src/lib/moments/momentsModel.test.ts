import {
  classifyMoments,
  findActiveMoment,
  type TimedMoment,
  type VideoMoment,
} from "./momentsModel"

function moment(overrides: Partial<VideoMoment> = {}): VideoMoment {
  return {
    startSeconds: 30,
    endSeconds: 60,
    summary: "Jesus teaches on the hillside",
    bibleVerses: ["Matthew 5:3-12"],
    ...overrides,
  }
}

describe("classifyMoments", () => {
  it("classifies distinct anchors as timed, sorted by start", () => {
    const result = classifyMoments([
      moment({ startSeconds: 90 }),
      moment({ startSeconds: 30 }),
    ])
    expect(result.kind).toBe("timed")
    if (result.kind === "timed") {
      expect(result.timeline.map((m) => m.startSeconds)).toEqual([30, 90])
    }
  })

  it("classifies null anchors as untimed", () => {
    const result = classifyMoments([
      moment({ startSeconds: null }),
      moment({ startSeconds: null, summary: "Second scene" }),
    ])
    expect(result.kind).toBe("untimed")
    if (result.kind === "untimed") expect(result.list).toHaveLength(2)
  })

  // The degeneracy rule — the COALESCE-to-0 shape the Step 0 probe found in
  // production. All-equal anchors MUST NOT count as a timeline: every
  // jump row would seek to 0:00.
  it("treats all-identical anchors (the COALESCE-to-0 shape) as untimed", () => {
    const result = classifyMoments([
      moment({ startSeconds: 0 }),
      moment({ startSeconds: 0, summary: "Second scene" }),
      moment({ startSeconds: 0, summary: "Third scene" }),
    ])
    expect(result.kind).toBe("untimed")
  })

  it("needs at least two timed anchors for a timeline", () => {
    // One genuine anchor cannot follow a playhead meaningfully.
    const result = classifyMoments([
      moment({ startSeconds: 120 }),
      moment({ startSeconds: null, summary: "Second scene" }),
    ])
    expect(result.kind).toBe("untimed")
  })

  it("a genuine 0 counts when a DISTINCT anchor accompanies it", () => {
    // 0 is only poisonous when it is the COALESCE default everywhere; a film
    // that truly opens at 0 with later anchors is fully timed.
    const result = classifyMoments([
      moment({ startSeconds: 0 }),
      moment({ startSeconds: 300 }),
    ])
    expect(result.kind).toBe("timed")
  })

  it("drops moments with nothing to show, and reports empty when none remain", () => {
    expect(
      classifyMoments([moment({ summary: null, bibleVerses: [] })]),
    ).toEqual({ kind: "empty" })
    expect(classifyMoments([])).toEqual({ kind: "empty" })
  })

  it("keeps a verse-only moment renderable (scripture without a summary)", () => {
    const result = classifyMoments([
      moment({ summary: null, startSeconds: null }),
    ])
    expect(result.kind).toBe("untimed")
  })

  it("rejects non-finite and negative anchors from the timeline", () => {
    const result = classifyMoments([
      moment({ startSeconds: Number.NaN }),
      moment({ startSeconds: -10, summary: "Second scene" }),
    ])
    expect(result.kind).toBe("untimed")
  })
})

describe("findActiveMoment", () => {
  const timeline: TimedMoment[] = [
    { ...moment(), startSeconds: 10 },
    { ...moment({ summary: "Scene two" }), startSeconds: 60 },
    { ...moment({ summary: "Scene three" }), startSeconds: 300 },
  ] as TimedMoment[]

  it("returns undefined before the first anchor", () => {
    expect(findActiveMoment(timeline, 5)).toBeUndefined()
  })

  it("returns the anchor at exactly its boundary", () => {
    expect(findActiveMoment(timeline, 10)?.startSeconds).toBe(10)
    expect(findActiveMoment(timeline, 60)?.startSeconds).toBe(60)
  })

  it("holds a moment until the NEXT anchor, even past its endSeconds", () => {
    // endSeconds of the first entry is 60-shaped via the fixture; at t=59.9
    // the first moment still holds; past 300 the third takes over.
    expect(findActiveMoment(timeline, 59.9)?.startSeconds).toBe(10)
    expect(findActiveMoment(timeline, 299)?.startSeconds).toBe(60)
    expect(findActiveMoment(timeline, 5000)?.startSeconds).toBe(300)
  })

  it("returns undefined on an empty timeline or a non-finite playhead", () => {
    expect(findActiveMoment([], 30)).toBeUndefined()
    expect(findActiveMoment(timeline, Number.NaN)).toBeUndefined()
  })
})
