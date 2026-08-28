import {
  STILL_WINDOW_END,
  STILL_WINDOW_START,
  deriveBibleCardArt,
  type BibleCardArtInput,
} from "../bibleCardArt"
import type { WatchBibleCitation, WatchVariant } from "../normalizeVideo"

// Every gated field is an explicit argument. Deriving `muxPlaybackId` from
// `documentId` (or `duration` from either) would let one fixture fail several
// gates at once, and a test meant to prove the playback-id gate would pass for
// the runtime gate's reason instead.
function variant(fields: Partial<WatchVariant> = {}): WatchVariant {
  return {
    documentId: "dub-a",
    slug: "en",
    published: true,
    hls: null,
    duration: 6794,
    languageCoreId: null,
    languageBcp47: null,
    languageSlug: null,
    languageName: null,
    languageNameNative: null,
    muxPlaybackId: "playbackA",
    ...fields,
  }
}

function citation(
  fields: Partial<WatchBibleCitation> = {},
): WatchBibleCitation {
  return {
    documentId: "cit-1",
    osisId: null,
    bookName: "Hebrews",
    chapterStart: 1,
    chapterEnd: null,
    verseStart: 1,
    verseEnd: null,
    order: 0,
    ...fields,
  }
}

function citations(count: number): WatchBibleCitation[] {
  return Array.from({ length: count }, (_, i) =>
    citation({ documentId: `cit-${i + 1}`, order: i }),
  )
}

const STOCK = [
  "https://stock.example.com/one.jpg",
  "https://stock.example.com/two.jpg",
  "https://stock.example.com/three.jpg",
] as const

const AUTHORED = "https://images.example.com/authored.jpg"

function input(fields: Partial<BibleCardArtInput> = {}): BibleCardArtInput {
  return {
    variants: [variant()],
    authoredImageUrl: AUTHORED,
    citations: citations(1),
    stockImages: STOCK,
    payloadSettled: true,
    ...fields,
  }
}

function secondsOf(url: string): number {
  const match = /[?&]time=([0-9.]+)/.exec(url)
  if (match?.[1] == null) throw new Error(`no time in ${url}`)
  return Number(match[1])
}

const isStill = (url: string) => url.startsWith("https://image.mux.com/")

describe("deriveBibleCardArt — still selection", () => {
  it("gives ten citations ten distinct stills inside the 10-90% window (AE1)", () => {
    const runtime = 6794
    const result = deriveBibleCardArt(
      input({
        variants: [variant({ duration: runtime })],
        citations: citations(10),
      }),
    )

    const stills = result.candidates.map((list) => list[0] as string)
    expect(stills).toHaveLength(10)
    expect(stills.every(isStill)).toBe(true)
    expect(new Set(stills).size).toBe(10)

    for (const url of stills) {
      const second = secondsOf(url)
      expect(second).toBeGreaterThanOrEqual(runtime * STILL_WINDOW_START)
      expect(second).toBeLessThanOrEqual(runtime * STILL_WINDOW_END)
    }
  })

  it("returns byte-identical output for identical inputs (AE2, AE3)", () => {
    const first = deriveBibleCardArt(input({ citations: citations(4) }))
    const second = deriveBibleCardArt(input({ citations: citations(4) }))
    expect(first).toEqual(second)
  })

  it("pins the same dub however the variants array is ordered", () => {
    const a = variant({ documentId: "dub-a", muxPlaybackId: "playbackA" })
    const b = variant({ documentId: "dub-b", muxPlaybackId: "playbackB" })
    const c = variant({ documentId: "dub-c", muxPlaybackId: "playbackC" })

    const forward = deriveBibleCardArt(input({ variants: [a, b, c] }))
    const shuffled = deriveBibleCardArt(input({ variants: [c, a, b] }))

    expect(forward.candidates).toEqual(shuffled.candidates)
    expect(forward.candidates[0]?.[0]).toContain("/playbackA/")
  })

  it("does not follow the active dub: a second dub never changes the URLs (R4)", () => {
    // The viewer switching audio language re-renders with the same variants
    // array; nothing about the pin reads which one is playing.
    const variants = [
      variant({ documentId: "dub-a", muxPlaybackId: "playbackA" }),
      variant({ documentId: "dub-b", muxPlaybackId: "playbackB" }),
    ]
    const result = deriveBibleCardArt(input({ variants }))
    expect(result.candidates[0]?.[0]).toContain("/playbackA/")
  })

  it("passes over a sorted-first dub that resolves no playback id", () => {
    const variants = [
      variant({ documentId: "dub-a", muxPlaybackId: null, hls: null }),
      variant({ documentId: "dub-b", muxPlaybackId: "playbackB" }),
    ]
    const result = deriveBibleCardArt(input({ variants }))
    expect(result.candidates[0]?.[0]).toContain("/playbackB/")
  })

  it("passes over a sorted-first dub that reports no runtime", () => {
    const variants = [
      variant({
        documentId: "dub-a",
        muxPlaybackId: "playbackA",
        duration: null,
      }),
      variant({
        documentId: "dub-b",
        muxPlaybackId: "playbackB",
        duration: 600,
      }),
    ]
    const result = deriveBibleCardArt(input({ variants }))
    expect(result.candidates[0]?.[0]).toContain("/playbackB/")
  })

  it("skips an unpublished dub even when it sorts first and is complete", () => {
    const variants = [
      variant({
        documentId: "dub-a",
        published: false,
        muxPlaybackId: "playbackA",
      }),
      variant({ documentId: "dub-b", muxPlaybackId: "playbackB" }),
    ]
    const result = deriveBibleCardArt(input({ variants }))
    expect(result.candidates[0]?.[0]).toContain("/playbackB/")
  })

  it("recovers the playback id from the dub's stream URL when the mux record is absent", () => {
    const variants = [
      variant({
        muxPlaybackId: null,
        hls: "https://stream.mux.com/playbackFromHls.m3u8",
      }),
    ]
    const result = deriveBibleCardArt(input({ variants }))
    expect(result.candidates[0]?.[0]).toContain("/playbackFromHls/")
  })

  it("gives every citation a still when the reference labels collide (AE9)", () => {
    // Two citations that resolve to the same reference label are still two
    // positions, so they take two timestamps.
    const same = [
      citation({ documentId: "cit-1", order: 0 }),
      citation({ documentId: "cit-2", order: 1 }),
    ]
    const result = deriveBibleCardArt(input({ citations: same }))
    expect(result.candidates[0]?.[0]).not.toBe(result.candidates[1]?.[0])
  })

  it("assigns the same citation the same still however the array is ordered", () => {
    // Admin's `order` collapses nulls to zero, so two citations can swap
    // positions between requests. The documentId tie-break is what stops that
    // from changing every still on the video.
    const a = citation({ documentId: "cit-a", order: null })
    const b = citation({ documentId: "cit-b", order: null })

    const forward = deriveBibleCardArt(input({ citations: [a, b] }))
    const reversed = deriveBibleCardArt(input({ citations: [b, a] }))

    expect(forward.candidates[0]).toEqual(reversed.candidates[1])
    expect(forward.candidates[1]).toEqual(reversed.candidates[0])
  })

  it("keeps ten stills distinct on a runtime short enough to collapse the window", () => {
    const result = deriveBibleCardArt(
      input({
        variants: [variant({ duration: 20 })],
        citations: citations(10),
      }),
    )
    const stills = result.candidates.map((list) => list[0] as string)
    expect(new Set(stills).size).toBe(10)
    for (const url of stills) {
      expect(secondsOf(url)).toBeGreaterThan(0)
      expect(secondsOf(url)).toBeLessThanOrEqual(20 * STILL_WINDOW_END)
    }
  })

  it("draws a single citation from the middle of the film", () => {
    const result = deriveBibleCardArt(
      input({
        variants: [variant({ duration: 1000 })],
        citations: citations(1),
      }),
    )
    expect(secondsOf(result.candidates[0]?.[0] as string)).toBe(500)
  })
})

describe("deriveBibleCardArt — the runtime gate", () => {
  it("requests no still when the pinned dub reports a null runtime (AE10)", () => {
    const result = deriveBibleCardArt(
      input({ variants: [variant({ duration: null })] }),
    )
    expect(result.candidates[0]?.some(isStill)).toBe(false)
    expect(result.candidates[0]?.[0]).toBe(AUTHORED)
    expect(result.tier).toBe("authored")
  })

  it("treats a zero runtime exactly as a null one", () => {
    const zero = deriveBibleCardArt(
      input({ variants: [variant({ duration: 0 })] }),
    )
    const missing = deriveBibleCardArt(
      input({ variants: [variant({ duration: null })] }),
    )
    expect(zero.candidates).toEqual(missing.candidates)
  })

  it("requests no still for a negative or non-finite runtime", () => {
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = deriveBibleCardArt(
        input({ variants: [variant({ duration })] }),
      )
      expect(result.candidates[0]?.some(isStill)).toBe(false)
    }
  })
})

describe("deriveBibleCardArt — the fallback ladder", () => {
  it("falls to the authored artwork for every card when no still resolves (AE4)", () => {
    const result = deriveBibleCardArt(
      input({ variants: [], citations: citations(3) }),
    )
    // Deliberately the same image on each: a video carries one resolved
    // authored image, so there is nothing to vary.
    expect(result.candidates.map((list) => list[0])).toEqual([
      AUTHORED,
      AUTHORED,
      AUTHORED,
    ])
    expect(result.tier).toBe("authored")
  })

  it("falls to the stock set when there is neither a still nor authored art (AE5)", () => {
    const result = deriveBibleCardArt(
      input({ variants: [], authoredImageUrl: null, citations: citations(4) }),
    )
    expect(result.candidates.map((list) => list[0])).toEqual([
      STOCK[0],
      STOCK[1],
      STOCK[2],
      STOCK[0],
    ])
    expect(result.tier).toBe("stock")
  })

  it("falls past a present-but-blank authored field rather than rendering it (AE6)", () => {
    // Admin passes provider columns through raw, so an empty string is a real
    // shape — and `??` would treat it as a hit.
    const result = deriveBibleCardArt(
      input({ variants: [], authoredImageUrl: "" }),
    )
    expect(result.candidates[0]).toEqual([STOCK[0]])
    expect(result.tier).toBe("stock")
  })

  it("falls past an authored value the URL validator rejects", () => {
    const result = deriveBibleCardArt(
      input({ variants: [], authoredImageUrl: "javascript:alert(1)" }),
    )
    expect(result.candidates[0]).toEqual([STOCK[0]])
  })

  it("orders each list still, authored, stock, with rejected tiers omitted", () => {
    const full = deriveBibleCardArt(input())
    expect(full.candidates[0]).toHaveLength(3)
    expect(isStill(full.candidates[0]?.[0] as string)).toBe(true)
    expect(full.candidates[0]?.[1]).toBe(AUTHORED)
    expect(full.candidates[0]?.[2]).toBe(STOCK[0])

    const noAuthored = deriveBibleCardArt(input({ authoredImageUrl: null }))
    // A rejected tier is omitted, never left as a hole.
    expect(noAuthored.candidates[0]).toHaveLength(2)
    expect(isStill(noAuthored.candidates[0]?.[0] as string)).toBe(true)
    expect(noAuthored.candidates[0]?.[1]).toBe(STOCK[0])
  })

  it("returns only validated URLs, so the render site cannot be handed a reject", () => {
    const result = deriveBibleCardArt(
      input({
        variants: [],
        authoredImageUrl: "ftp://images.example.com/nope.jpg",
        stockImages: ["not a url", STOCK[1]],
        citations: citations(2),
      }),
    )
    for (const list of result.candidates) {
      for (const url of list) {
        expect(url.startsWith("https://")).toBe(true)
      }
    }
    // Position 0's stock entry was the rejected one, so that card has nothing.
    expect(result.candidates[0]).toEqual([])
    expect(result.candidates[1]).toEqual([STOCK[1]])
  })

  it("returns an empty list per card when every tier is unavailable", () => {
    const result = deriveBibleCardArt(
      input({ variants: [], authoredImageUrl: null, stockImages: [] }),
    )
    expect(result.candidates).toEqual([[]])
    expect(result.tier).toBe("none")
  })
})

describe("deriveBibleCardArt — the unsettled-payload hold (KTD15)", () => {
  it("holds every card empty while the payload has not settled", () => {
    // The lean series fragment carries no runtime and no playback id, so the
    // series-to-episode path arrives here looking exactly like a still-less
    // video. Holding is what stops the card painting stock and then flipping.
    const result = deriveBibleCardArt(
      input({
        variants: [variant({ duration: null, muxPlaybackId: null, hls: null })],
        payloadSettled: false,
        citations: citations(3),
      }),
    )
    expect(result.candidates).toEqual([[], [], []])
    expect(result.tier).toBe("unsettled")
  })

  it("falls through on the same variant shape once the payload settles (AE12)", () => {
    const variants = [
      variant({ duration: null, muxPlaybackId: null, hls: null }),
    ]
    const settled = deriveBibleCardArt(
      input({ variants, authoredImageUrl: null, payloadSettled: true }),
    )
    expect(settled.candidates[0]).toEqual([STOCK[0]])
    expect(settled.tier).toBe("stock")
  })

  it("does not hold when a still resolves, settled or not", () => {
    const result = deriveBibleCardArt(input({ payloadSettled: false }))
    expect(isStill(result.candidates[0]?.[0] as string)).toBe(true)
    expect(result.tier).toBe("still")
  })

  it("holds nothing for a video with no citations", () => {
    const result = deriveBibleCardArt(
      input({ citations: [], payloadSettled: false }),
    )
    expect(result.candidates).toEqual([])
  })
})

describe("deriveBibleCardArt — the reported outcome", () => {
  it("reports one list per citation, and none for none", () => {
    expect(
      deriveBibleCardArt(input({ citations: citations(1) })).candidates,
    ).toHaveLength(1)
    expect(deriveBibleCardArt(input({ citations: [] })).candidates).toEqual([])
  })

  it("reports the top tier the video resolved", () => {
    expect(deriveBibleCardArt(input()).tier).toBe("still")
    expect(deriveBibleCardArt(input({ variants: [] })).tier).toBe("authored")
    expect(
      deriveBibleCardArt(input({ variants: [], authoredImageUrl: null })).tier,
    ).toBe("stock")
  })

  it("reports whether the video carries a playback id at all", () => {
    // The monitoring denominator: videos that CAN serve a still but resolved
    // to stock are the alertable population.
    expect(deriveBibleCardArt(input()).hasPlaybackId).toBe(true)
    expect(
      deriveBibleCardArt(input({ variants: [variant({ duration: null })] }))
        .hasPlaybackId,
    ).toBe(true)
    expect(deriveBibleCardArt(input({ variants: [] })).hasPlaybackId).toBe(
      false,
    )
  })
})
