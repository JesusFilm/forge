import { describe, expect, it } from "vitest"
import { pageStudioSourceCues } from "./sources"

describe("bounded canonical source text", () => {
  it("retains every complete cue across byte-bounded pages and rejects an oversized cue explicitly", () => {
    const cues = Array.from({ length: 50 }, (_, i) => ({
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      text: "漢".repeat(1000),
    }))
    const first = pageStudioSourceCues(cues, 0, 50)
    expect(first.cues.length).toBeLessThan(50)
    expect(
      new TextEncoder().encode(JSON.stringify(first.cues)).length,
    ).toBeLessThanOrEqual(32768)
    let offset = first.nextOffset
    const recovered = [...first.cues]
    while (offset !== null) {
      const next = pageStudioSourceCues(cues, offset, 50)
      recovered.push(...next.cues)
      offset = next.nextOffset
    }
    expect(recovered).toEqual(cues)
    expect(() =>
      pageStudioSourceCues(
        [{ startMs: 0, endMs: 1, text: "漢".repeat(12000) }],
        0,
        1,
      ),
    ).toThrow("exceeds preview page capacity")
    expect(() => pageStudioSourceCues(cues, 51, 1)).toThrow()
  })
})
