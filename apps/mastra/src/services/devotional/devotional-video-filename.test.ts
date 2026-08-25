import { describe, expect, it } from "vitest"

import { devotionalVideoFilename } from "./devotional-render"

const BASE = {
  clipTitle: "Jesus and Zaccheus",
  sequence: 0,
  lang: "en",
  aspect: "portrait" as const,
}

describe("devotionalVideoFilename", () => {
  it("names a plain English portrait render", () => {
    expect(devotionalVideoFilename(BASE)).toBe("jesus-and-zaccheus-seq0.mp4")
  })

  it("keeps episodes of one scene apart", () => {
    // The live bug: episode 1 overwrote the full-scene devotional, because a
    // scene's episodes share the clip title AND the sequence.
    const one = devotionalVideoFilename({ ...BASE, episode: 1 })
    const two = devotionalVideoFilename({ ...BASE, episode: 2 })
    expect(one).toBe("jesus-and-zaccheus-seq0-ep1.mp4")
    expect(new Set([one, two, devotionalVideoFilename(BASE)]).size).toBe(3)
  })

  it("keeps every varying dimension apart from every other", () => {
    const names = [
      devotionalVideoFilename(BASE),
      devotionalVideoFilename({ ...BASE, episode: 1 }),
      devotionalVideoFilename({ ...BASE, lang: "ru" }),
      devotionalVideoFilename({ ...BASE, aspect: "wide" }),
      devotionalVideoFilename({ ...BASE, sequence: 1 }),
      devotionalVideoFilename({
        ...BASE,
        episode: 1,
        lang: "ru",
        aspect: "wide",
      }),
    ]
    expect(new Set(names).size).toBe(names.length)
  })

  it("slugs punctuation and case out of the clip title", () => {
    expect(
      devotionalVideoFilename({
        ...BASE,
        clipTitle: "Jesus' Triumphal Entry!",
      }),
    ).toBe("jesus-triumphal-entry-seq0.mp4")
  })

  it("does not tag episode 0 or undefined — only a real episode number", () => {
    expect(devotionalVideoFilename({ ...BASE, episode: 0 })).toBe(
      "jesus-and-zaccheus-seq0.mp4",
    )
  })
})
