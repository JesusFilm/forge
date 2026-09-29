import { describe, expect, it } from "vitest"

import { readSubtitles } from "./devotional-script-format"
import { videoSource } from "./video-sources"

describe("readSubtitles", () => {
  it("reads the Prodigal Son cues as the narrator speaks them (NIV, not BSB)", async () => {
    const cues = await readSubtitles(videoSource("lumo-luke-15")!)
    expect(cues[0]).toBe("Jesus continued. There was a man who had two sons.")
    expect(cues.at(-1)).toBe(
      "was dead and is alive again; he was lost and is found.",
    )
    expect(cues).toHaveLength(36)
  })
})
