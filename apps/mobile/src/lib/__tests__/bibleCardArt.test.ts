import {
  STILL_WINDOW_END,
  STILL_WINDOW_START,
  deriveBibleCardArt,
  type BibleCardArtInput,
} from "../bibleCardArt"
import type { WatchBibleCitation, WatchVariant } from "../normalizeVideo"

// Every gated field is an explicit argument: deriving one from another lets a
// single fixture fail several gates at once, so a test meant to prove the
// playback-id gate would pass for the runtime gate's reason instead.
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
    primaryLanguageCoreId: null,
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

  it("falls back to the sorted-first dub when none qualifies", () => {
    // Every dub carries an id but no runtime, so the qualified pass finds
    // nothing and the fallback decides. It must still be deterministic, or the
    // authored/stock rung a video lands on could differ between requests.
    const variants = [
      variant({
        documentId: "dub-c",
        muxPlaybackId: "playbackC",
        duration: null,
      }),
      variant({
        documentId: "dub-a",
        muxPlaybackId: "playbackA",
        duration: null,
      }),
      variant({
        documentId: "dub-b",
        muxPlaybackId: "playbackB",
        duration: null,
      }),
    ]
    const forward = deriveBibleCardArt(input({ variants }))
    const shuffled = deriveBibleCardArt(
      input({ variants: [variants[1]!, variants[2]!, variants[0]!] }),
    )

    expect(forward.candidates).toEqual(shuffled.candidates)
    expect(forward.tier).toBe("authored")
    expect(forward.hasPlaybackId).toBe(true)
  })

  it("pins the film's own language over a lower-sorting foreign dub", () => {
    // Production shape from `the-meaning-of-christmas--episode-3`: a Ukrainian
    // dub sorts before the English one, and its frames carry burned-in Cyrillic
    // subtitles, which the card was rendering as its artwork.
    const variants = [
      variant({
        documentId: "56cbf635",
        languageBcp47: "uk",
        muxPlaybackId: "playbackUK",
      }),
      variant({
        documentId: "60a9a019",
        languageCoreId: "lang-en",
        muxPlaybackId: "playbackEN",
      }),
    ]
    const result = deriveBibleCardArt(
      input({ variants, primaryLanguageCoreId: "lang-en" }),
    )
    expect(result.candidates[0]?.[0]).toContain("/playbackEN/")
  })

  it("never treats a tag-colliding dub as the film's own language", () => {
    // `en-nai` is English, North American Indigenous — a DIFFERENT language
    // that shares the `en` base. It sorts second here on purpose: a bcp47
    // prefix match would prefer it, and the documentId sort would not.
    const variants = [
      variant({
        documentId: "dub-a",
        languageCoreId: "lang-de",
        languageBcp47: "de",
        muxPlaybackId: "playbackDE",
      }),
      variant({
        documentId: "dub-b",
        languageCoreId: "lang-en-nai",
        languageBcp47: "en-nai",
        muxPlaybackId: "playbackNAI",
      }),
    ]
    const result = deriveBibleCardArt(
      input({ variants, primaryLanguageCoreId: "lang-en" }),
    )
    expect(result.candidates[0]?.[0]).toContain("/playbackDE/")
  })

  it("stays on the sorted-first dub when the primary language has no dub", () => {
    // The preference is additive: with nothing to prefer, determinism is still
    // the documentId sort, so R3 holds exactly as before.
    const variants = [
      variant({
        documentId: "dub-a",
        languageBcp47: "uk",
        muxPlaybackId: "playbackUK",
      }),
      variant({
        documentId: "dub-b",
        languageBcp47: "de",
        muxPlaybackId: "playbackDE",
      }),
    ]
    const result = deriveBibleCardArt(
      input({ variants, primaryLanguageCoreId: "lang-fr" }),
    )
    expect(result.candidates[0]?.[0]).toContain("/playbackUK/")
  })

  it("does not let the language preference override the runtime gate", () => {
    // A primary-language dub with no runtime cannot serve a still, so the
    // preference must not demote a video a sibling dub can actually serve.
    const variants = [
      variant({
        documentId: "dub-a",
        languageCoreId: "lang-en",
        muxPlaybackId: "playbackEN",
        duration: null,
      }),
      variant({
        documentId: "dub-b",
        languageBcp47: "uk",
        muxPlaybackId: "playbackUK",
        duration: 600,
      }),
    ]
    const result = deriveBibleCardArt(
      input({ variants, primaryLanguageCoreId: "lang-en" }),
    )
    expect(result.candidates[0]?.[0]).toContain("/playbackUK/")
    expect(result.tier).toBe("still")
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

  it("recovers a clean id from the stream URL when the stored one is malformed", () => {
    // Admin passes these through raw, and this catalogue is known to carry a
    // trailing newline on stored Mux fields. A malformed value must not
    // short-circuit the fallback that can still recover a usable id.
    const variants = [
      variant({
        muxPlaybackId: "playbackA\n",
        hls: "https://stream.mux.com/playbackClean.m3u8",
      }),
    ]
    const result = deriveBibleCardArt(input({ variants }))
    expect(result.candidates[0]?.[0]).toContain("/playbackClean/")
    expect(result.tier).toBe("still")
  })

  it("reports the real tier when a malformed id can serve no still", () => {
    // The still rung is silently absent here. Reporting "still" anyway would
    // make the plan's one alert — videos that carry a playback id yet resolve
    // to stock — read this exact failure as healthy.
    const variants = [variant({ muxPlaybackId: "play-back_A", hls: null })]
    const result = deriveBibleCardArt(
      input({ variants, authoredImageUrl: null }),
    )

    expect(result.candidates[0]?.some(isStill)).toBe(false)
    expect(result.tier).toBe("stock")
    // Still in the denominator: admin DID supply an id, so this video is
    // exactly what the alert is meant to catch.
    expect(result.hasPlaybackId).toBe(true)
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

  it("keeps the shortest real runtime off second zero and off one URL", () => {
    // Admin types duration as an Int, so ONE SECOND is the shortest runtime
    // production can hand us — the case where the window is tightest and the
    // two-decimal format has least room to keep ten citations apart.
    const result = deriveBibleCardArt(
      input({
        variants: [variant({ duration: 1 })],
        citations: citations(10),
      }),
    )
    const stills = result.candidates.map((list) => list[0] as string)

    // Second zero returns an all-black frame, and `toFixed(2)` is where a
    // collapsed window would round several cards onto it — or onto each other.
    expect(new Set(stills).size).toBe(10)
    for (const url of stills) {
      expect(url).not.toContain("time=0.00")
      expect(secondsOf(url)).toBeGreaterThan(0)
    }
  })

  it("lets the window cap win over the floor when the two invert", () => {
    // SYNTHETIC runtime: `duration` is an Int upstream, so a sub-second value
    // cannot occur — this fixture exists only to pin the clamp ORDER inside
    // `stillSecond`, where the window's top falls below the minimum second.
    const runtime = 0.005
    const result = deriveBibleCardArt(
      input({
        variants: [variant({ duration: runtime })],
        citations: citations(2),
      }),
    )
    for (const list of result.candidates) {
      const second = secondsOf(list[0] as string)
      expect(second).toBeLessThanOrEqual(runtime * STILL_WINDOW_END)
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

  it("drops a protocol-relative authored value rather than resolving its host", () => {
    // `//evil.example/x.png` is rejected today only because `new URL()` throws
    // with no base. Nothing else pins it, so adding a base to the validator
    // would silently start honouring an attacker-chosen host.
    const result = deriveBibleCardArt(
      input({
        variants: [],
        authoredImageUrl: "//evil.example/card.png",
        stockImages: [],
        citations: citations(1),
      }),
    )
    expect(result.candidates[0]).toEqual([])
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
