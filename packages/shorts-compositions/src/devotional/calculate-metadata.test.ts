import { describe, expect, it } from "vitest"

import { calculateDevotionalMetadata } from "./calculate-metadata"
import type { DevotionalInputProps } from "./schema"
import { framesFromDurations } from "./timing"

describe("calculateDevotionalMetadata", () => {
  it("honours a card's own tailSec, matching the composition's layout", async () => {
    const cards = [
      { kind: "reflection-focus", text: "One.", durationSec: 2, tailSec: 0.35 },
      { kind: "reflection-focus", text: "Two.", durationSec: 3 },
    ] as DevotionalInputProps["cards"]
    const props = {
      cards,
      introHoldSec: 0,
      outroHoldSec: 8,
    } as unknown as DevotionalInputProps
    const meta = await calculateDevotionalMetadata({
      props,
      defaultProps: props,
      abortSignal: new AbortController().signal,
      compositionId: "devotional-wide",
      isRendering: true,
    })
    const laidOut = framesFromDurations(cards, 30, 24, 240, 0).reduce(
      (s, f) => s + f.durationInFrames,
      0,
    )
    // 60 + 11 (0.35s tail) + 90 + 24 + 240
    expect(meta.durationInFrames).toBe(425)
    expect(meta.durationInFrames).toBe(laidOut)
  })
})
