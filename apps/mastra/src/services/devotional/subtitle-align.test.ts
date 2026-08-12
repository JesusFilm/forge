import { describe, expect, it } from "vitest"

import {
  alignWindow,
  mapCuesToEditedTimeline,
  parseSubtitles,
  removeInternalGaps,
} from "./subtitle-align"

const SRT = `1
00:00:42,800 --> 00:00:47,300
искал видеть Иисуса, но не мог за народом

2
00:00:47,300 --> 00:00:50,100
Он влез на смоковницу, чтобы увидеть Его.

3
00:01:20,800 --> 00:01:30,500
Половину имения моего я отдам нищим, и воздам вчетверо!
`

const VTT = `WEBVTT

00:00:42.800 --> 00:00:47.300
line one

00:00:47.300 --> 00:00:50.100
line two
`

describe("parseSubtitles", () => {
  it("parses srt cues with times + text", () => {
    const cues = parseSubtitles(SRT)
    expect(cues).toHaveLength(3)
    expect(cues[0].start).toBeCloseTo(42.8, 1)
    expect(cues[0].end).toBeCloseTo(47.3, 1)
    expect(cues[2].start).toBeCloseTo(80.8, 1) // 1:20.8
    expect(cues[2].end).toBeCloseTo(90.5, 1) // 1:30.5
    expect(cues[0].text).toContain("искал видеть Иисуса")
  })

  it("parses vtt (WEBVTT header, dot millis)", () => {
    const cues = parseSubtitles(VTT)
    expect(cues).toHaveLength(2)
    expect(cues[0].start).toBeCloseTo(42.8, 1)
  })
})

describe("alignWindow", () => {
  const cues = parseSubtitles(SRT)

  it("snaps start + end to clean cue boundaries", () => {
    // desired 44..92 → start snaps back to 42.8 (sentence start), end to 90.5
    const w = alignWindow(cues, 44, 48)
    expect(w).not.toBeNull()
    expect(w!.startSec).toBeCloseTo(42.8, 1)
    expect(w!.lengthSec).toBeCloseTo(47.7, 1) // 90.5 - 42.8
  })

  it("returns null when snapping leaves too little (keeps curated window)", () => {
    expect(alignWindow(cues, 44, 2)).toBeNull()
  })

  it("enforces a 30s floor by default (owner rule: the clip must show a whole scene, not a single short cue)", () => {
    // A window that snaps to a real ~20s sentence-to-sentence span would have
    // passed the old 12s floor — it must now be rejected so the caller falls
    // back to the full curated window instead of airing a too-short clip.
    const shortScene = parseSubtitles(`1
00:00:10,000 --> 00:00:15,000
First sentence here.

2
00:00:15,000 --> 00:00:30,000
Second sentence, still going.
`)
    expect(alignWindow(shortScene, 10, 20)).toBeNull()
    // ...but an explicit lower floor (e.g. a caller that truly wants a short
    // window) still works — the 30s default is a default, not a hard limit.
    expect(alignWindow(shortScene, 10, 20, 15)).not.toBeNull()
  })

  it("returns null on empty cues", () => {
    expect(alignWindow([], 44, 48)).toBeNull()
  })

  it("snaps the start back to a SENTENCE opening, skipping a mid-sentence cue", () => {
    // cue2 (42.8) continues cue1's sentence (cue1 ends with a comma), so a
    // window targeting 44 must snap back to cue1's sentence opening (37.1),
    // not start mid-sentence at 42.8.
    const scene = parseSubtitles(`1
00:00:37,100 --> 00:00:42,800
Иисус вошёл в Иерихон. И вот некто именем Закхей, богатый,

2
00:00:42,800 --> 00:00:47,300
искал видеть Иисуса, но не мог.

3
00:01:20,800 --> 00:01:30,500
Половину имения моего я отдам нищим!
`)
    const w = alignWindow(scene, 44, 48)
    expect(w).not.toBeNull()
    expect(w!.startSec).toBeCloseTo(37.1, 1) // sentence opening, not 42.8
    expect(w!.lengthSec).toBeCloseTo(53.4, 1) // 90.5 - 37.1
  })
})

describe("removeInternalGaps", () => {
  // Real cue timings from "Jesus Feeds 5,000" (RU + EN dubs agree): Peter's
  // request, then two dead-air gaps (10.9s, 15.0s) around a short 6.2s gap
  // that must be LEFT ALONE (owner rule: only gaps >= 10s get cut).
  const cues = parseSubtitles(`1
00:00:47,500 --> 00:01:03,300
Master, send the people away, so they can go to the villages and find food.

2
00:01:14,200 --> 00:01:16,100
You yourselves give them something to eat.

3
00:01:16,200 --> 00:01:20,000
But all we have are five loaves and two fish.

4
00:01:35,000 --> 00:01:44,000
Blessed are You, O Lord our God, Who brings forth bread from the earth.

5
00:01:50,200 --> 00:01:52,000
It's a miracle.

6
00:01:52,400 --> 00:01:54,000
Unbelievable!
`)

  it("cuts both dead-air gaps (10.9s, 15.0s) with a 1.5s/3s buffer, leaves the 6.2s gap alone", () => {
    const segs = removeInternalGaps(cues, 47.5, 114 - 47.5)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ startSec: 47.5 })
    expect(segs[0].lengthSec).toBeCloseTo(17.3, 1) // ends 63.3+1.5=64.8
    expect(segs[1].startSec).toBeCloseTo(71.2, 1) // 74.2-3
    expect(segs[1].lengthSec).toBeCloseTo(10.3, 1) // ends 80.0+1.5=81.5
    expect(segs[2].startSec).toBeCloseTo(92.0, 1) // 95.0-3
    expect(segs[2].lengthSec).toBeCloseTo(22.0, 1) // runs to windowEnd=114, THROUGH the 6.2s gap
  })

  it("returns the whole window unchanged when no gap reaches the minimum", () => {
    const noBigGaps = parseSubtitles(`1
00:00:10,000 --> 00:00:15,000
Line one.

2
00:00:20,000 --> 00:00:25,000
Line two, five second gap only.
`)
    expect(removeInternalGaps(noBigGaps, 10, 20)).toEqual([
      { startSec: 10, lengthSec: 20 },
    ])
  })

  it("returns the whole window unchanged when there are no cues inside it", () => {
    expect(removeInternalGaps(cues, 200, 30)).toEqual([
      { startSec: 200, lengthSec: 30 },
    ])
  })

  it("respects a custom minGapSec / buffer configuration", () => {
    const segs = removeInternalGaps(cues, 47.5, 114 - 47.5, {
      minGapSec: 5, // now the 6.2s gap also qualifies
      trailingBufferSec: 1,
      leadingBufferSec: 2,
    })
    expect(segs).toHaveLength(4) // the 6.2s gap now gets cut too
  })

  it("caps a qualifying gap at maxGapSec instead of cutting to the tiny bridge", () => {
    const segs = removeInternalGaps(cues, 47.5, 114 - 47.5, { maxGapSec: 5 })
    expect(segs).toHaveLength(3)
    // 10.9s gap: keeps 5s of buildup (63.3->68.3) instead of the 1.5s bridge.
    expect(segs[0].lengthSec).toBeCloseTo(20.8, 1) // ends 63.3+5=68.3
    expect(segs[1].startSec).toBeCloseTo(71.2, 1) // 74.2-3, unchanged
    // 15.0s gap: keeps 5s of buildup (80.0->85.0).
    expect(segs[1].lengthSec).toBeCloseTo(13.8, 1) // ends 80.0+5=85.0
    expect(segs[2].startSec).toBeCloseTo(92.0, 1) // 95.0-3, unchanged
  })

  it("keeps every second when a gap is already within maxGapSec (may still split at a cue boundary, but nothing is actually cut)", () => {
    // With maxGapSec=20, both 10.9s and 15.0s gaps are already <= the cap, so
    // `keepUntil` lands exactly on the next cue's start — no time is skipped,
    // even though the pieces still come back as separate (contiguous, zero-gap)
    // segments. Concatenating them is a no-op vs. one continuous segment.
    const segs = removeInternalGaps(cues, 47.5, 114 - 47.5, { maxGapSec: 20 })
    const total = segs.reduce((sum, s) => sum + s.lengthSec, 0)
    expect(total).toBeCloseTo(114 - 47.5, 5)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startSec).toBeCloseTo(
        segs[i - 1].startSec + segs[i - 1].lengthSec,
        5,
      )
    }
  })
})

describe("mapCuesToEditedTimeline", () => {
  const cues = parseSubtitles(`1
00:00:10,000 --> 00:00:14,000
First line.

2
00:00:40,000 --> 00:00:44,000
Second line, after a cut.
`)

  it("shifts cues earlier by the removed gap and scales by the speed-up", () => {
    // Two kept segments with 26s of dead air cut between them.
    const segments = [
      { startSec: 10, lengthSec: 6 }, // source 10-16 → edited 0-6
      { startSec: 38, lengthSec: 8 }, // source 38-46 → edited 6-14
    ]
    const out = mapCuesToEditedTimeline(cues, segments, 1)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ text: "First line." })
    expect(out[0].startSec).toBeCloseTo(0, 2)
    expect(out[0].endSec).toBeCloseTo(4, 2)
    // Second cue starts 2s into the second segment, which begins at edited 6s.
    expect(out[1].startSec).toBeCloseTo(8, 2)
    expect(out[1].endSec).toBeCloseTo(12, 2)
  })

  it("compresses every timestamp by the clip speed-up", () => {
    const segments = [{ startSec: 10, lengthSec: 40 }]
    const out = mapCuesToEditedTimeline(cues, segments, 1.12)
    expect(out[0].startSec).toBeCloseTo(0, 2)
    expect(out[0].endSec).toBeCloseTo(4 / 1.12, 2)
    expect(out[1].startSec).toBeCloseTo(30 / 1.12, 2)
  })

  it("drops cues outside the kept segments", () => {
    // Only the window around the FIRST cue survives.
    const out = mapCuesToEditedTimeline(cues, [{ startSec: 8, lengthSec: 10 }])
    expect(out.map((c) => c.text)).toEqual(["First line."])
  })

  it("clips a cue that straddles a cut instead of overrunning the edit", () => {
    // Segment ends mid-way through the first cue (source 10-14 → keep 10-12).
    const out = mapCuesToEditedTimeline(cues, [{ startSec: 10, lengthSec: 2 }])
    expect(out).toHaveLength(1)
    expect(out[0].endSec).toBeCloseTo(2, 2)
  })

  it("ignores slivers shorter than the minimum duration", () => {
    // Only 0.1s of the first cue survives — too short to flash on screen.
    const out = mapCuesToEditedTimeline(cues, [{ startSec: 13.9, lengthSec: 2 }])
    expect(out).toEqual([])
  })
})
