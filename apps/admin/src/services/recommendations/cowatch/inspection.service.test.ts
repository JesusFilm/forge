import { describe, expect, it } from "vitest"
import { chooseCowatchAnchors } from "./inspection.service"

describe("co-watch current anchors", () => {
  it("retains the current seed within the five-anchor budget", () => {
    const anchors = chooseCowatchAnchors({
      seedMediaId: "current-seed",
      interests: Array.from({ length: 5 }, (_, index) => ({
        mediaId: `interest-${index}`,
        kind: "durable" as const,
        interestOrdinal: index,
        weight: 1 - index / 10,
      })),
    })
    expect(anchors).toHaveLength(5)
    expect(anchors.map((anchor) => anchor.mediaId)).toEqual([
      "interest-0",
      "interest-1",
      "interest-2",
      "interest-3",
      "current-seed",
    ])
  })
})
