import { describe, expect, it, vi } from "vitest"

import { getWebVttCueText } from "./webvtt"

describe("getWebVttCueText", () => {
  it("uses the browser WebVTT parser instead of regex HTML sanitization", () => {
    const getCueAsHTML = vi.fn(
      () => ({ textContent: "Jesus said hello" }) as DocumentFragment,
    )

    const text = getWebVttCueText({ getCueAsHTML } as unknown as VTTCue)

    expect(text).toBe("Jesus said hello")
    expect(getCueAsHTML).toHaveBeenCalledOnce()
  })
})
