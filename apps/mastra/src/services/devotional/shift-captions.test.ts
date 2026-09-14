import { describe, expect, it } from "vitest"

import { shiftCaptions } from "./devotional-render"

/**
 * `--caption-offset` takes a negative value — the obvious correction when
 * captions read late. Clamping start and end independently collapsed any cue
 * ending within the offset to {0, 0}, and the composition builds a cue's fade
 * from [start - fade, start, end, end + fade]. A zero-length cue makes that
 * range non-monotonic, which Remotion throws on for every frame of the card:
 * the encode dies minutes in, after the film has been downloaded and trimmed,
 * with an error naming neither the cue nor the flag.
 */
const cue = (startSec: number, endSec: number) => ({
  startSec,
  endSec,
  text: `${startSec}-${endSec}`,
})

describe("shiftCaptions", () => {
  it("never emits a cue whose end is not after its start", () => {
    const shifted = shiftCaptions(
      [cue(0.2, 0.9), cue(1, 2), cue(2.5, 4), cue(10, 12)],
      -2,
    )
    for (const c of shifted) expect(c.endSec).toBeGreaterThan(c.startSec)
  })

  it("drops cues a negative offset pushes off the front entirely", () => {
    const shifted = shiftCaptions([cue(0.2, 0.9), cue(5, 6)], -2)
    expect(shifted.map((c) => c.text)).toEqual(["5-6"])
  })

  it("keeps a straddling cue, clamped to zero, with its tail intact", () => {
    const [only] = shiftCaptions([cue(1, 4)], -2)
    expect(only.startSec).toBe(0)
    expect(only.endSec).toBe(2)
  })

  it("preserves length and order for a positive offset", () => {
    const shifted = shiftCaptions([cue(1, 2), cue(3, 5)], 1.5)
    expect(shifted.map((c) => [c.startSec, c.endSec, c.text])).toEqual([
      [2.5, 3.5, "1-2"],
      [4.5, 6.5, "3-5"],
    ])
  })

  it("is identity at zero", () => {
    const input = [cue(1, 2)]
    expect(shiftCaptions(input, 0)).toBe(input)
  })
})
