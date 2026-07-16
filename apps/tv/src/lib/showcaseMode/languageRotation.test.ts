import {
  initialRotationState,
  rotateLanguage,
  type ShowcaseDubInput,
} from "./languageRotation"

// A playable dub: admin's contract is published === true AND a non-empty hls.
function dub(
  languageSlug: string | null,
  overrides: Partial<ShowcaseDubInput> = {},
): ShowcaseDubInput {
  return {
    published: true,
    hls: `https://stream/${languageSlug ?? "none"}.m3u8`,
    duration: 600,
    language: languageSlug
      ? { slug: languageSlug, name: { en: languageSlug.toUpperCase() } }
      : null,
    muxVideo: { playbackId: `pb-${languageSlug ?? "none"}` },
    ...overrides,
  }
}

describe("rotateLanguage — playability", () => {
  it("returns null when the video has no dubs at all", () => {
    expect(rotateLanguage([], initialRotationState)).toBeNull()
  })

  // The playable test is `published === true && hls != null && hls !== ""` —
  // an empty-string hls is NOT playable (normalizeVideo.ts's contract).
  it("rejects unpublished dubs and empty-string hls", () => {
    const unplayable = [
      dub("english", { published: false }),
      dub("spanish", { hls: "" }),
      dub("french", { hls: null }),
    ]
    expect(rotateLanguage(unplayable, initialRotationState)).toBeNull()
  })

  it("picks the one playable dub past unplayable siblings", () => {
    const dubs = [dub("english", { published: false }), dub("spanish")]
    const result = rotateLanguage(dubs, initialRotationState)
    expect(result?.pick.hls).toBe("https://stream/spanish.m3u8")
    expect(result?.pick.muxPlaybackId).toBe("pb-spanish")
  })

  // Language.name is admin's jsonb locale map, not a String — it must be read
  // through pickLocalizedName, never rendered raw.
  it("resolves the jsonb locale-map language name to a display string", () => {
    const dubs = [
      dub("spanish", {
        language: { slug: "spanish", name: { en: "Spanish" } },
      }),
    ]
    expect(rotateLanguage(dubs, initialRotationState)?.pick.languageName).toBe(
      "Spanish",
    )
  })
})

describe("rotateLanguage — AE4: single-dub makes no rotation claim", () => {
  it("yields the one language with claimsLanguage false", () => {
    const result = rotateLanguage([dub("english")], initialRotationState)
    expect(result?.pick.languageSlug).toBe("english")
    expect(result?.pick.claimsLanguage).toBe(false)
  })

  it("makes no claim when several dubs all carry the SAME language slug", () => {
    const result = rotateLanguage(
      [dub("english"), dub("english"), dub("english")],
      initialRotationState,
    )
    expect(result?.pick.claimsLanguage).toBe(false)
  })

  it("does not error and still advances rotation state for a single-dub video", () => {
    const result = rotateLanguage([dub("english")], initialRotationState)
    expect(result?.nextState.previousSlug).toBe("english")
  })
})

describe("rotateLanguage — R7: consecutive excerpts differ", () => {
  // Identity is language.slug, NEVER bcp47: ko-kmr collides with ko and en-nai
  // with en, so bcp47 would silently merge distinct languages.
  it("keys identity on language.slug, not bcp47", () => {
    const dubs = [
      dub("korean", {
        language: { slug: "korean", bcp47: "ko", name: { en: "Korean" } },
      }),
      dub("kurmanji", {
        language: { slug: "kurmanji", bcp47: "ko", name: { en: "Kurmanji" } },
      }),
    ]
    const first = rotateLanguage(dubs, initialRotationState)
    expect(first?.pick.languageSlug).toBe("korean")
    const second = rotateLanguage(dubs, first!.nextState)
    expect(second?.pick.languageSlug).toBe("kurmanji")
    expect(second?.pick.claimsLanguage).toBe(true)
  })

  it("yields 3 distinct slugs across a 3-excerpt chapter when available", () => {
    const dubs = [dub("english"), dub("spanish"), dub("french")]
    const picks: string[] = []
    let state = initialRotationState
    for (let i = 0; i < 3; i++) {
      const result = rotateLanguage(dubs, state)
      picks.push(result!.pick.languageSlug!)
      state = result!.nextState
    }
    expect(new Set(picks).size).toBe(3)
    expect(picks).toEqual(["english", "spanish", "french"])
  })

  it("claims the language once rotation actually varies it", () => {
    const dubs = [dub("english"), dub("spanish")]
    const first = rotateLanguage(dubs, initialRotationState)
    const second = rotateLanguage(dubs, first!.nextState)
    expect(second?.pick.languageSlug).toBe("spanish")
    expect(second?.pick.claimsLanguage).toBe(true)
  })

  // Exhaustion must not strand the reel on one language: the used set resets but
  // the immediately-previous slug stays excluded, so en,es,en,es — never en,en.
  it("never repeats the immediately-previous language when an alternative exists", () => {
    const dubs = [dub("english"), dub("spanish")]
    const picks: string[] = []
    let state = initialRotationState
    for (let i = 0; i < 4; i++) {
      const result = rotateLanguage(dubs, state)
      picks.push(result!.pick.languageSlug!)
      state = result!.nextState
    }
    expect(picks).toEqual(["english", "spanish", "english", "spanish"])
  })

  it("falls back to a repeat only when the video has a single language", () => {
    const first = rotateLanguage([dub("english")], initialRotationState)
    const second = rotateLanguage([dub("english")], first!.nextState)
    expect(second?.pick.languageSlug).toBe("english")
    expect(second?.pick.claimsLanguage).toBe(false)
  })

  it("plays a slug-less dub without claiming a language", () => {
    const result = rotateLanguage([dub(null)], initialRotationState)
    expect(result?.pick.hls).toBe("https://stream/none.m3u8")
    expect(result?.pick.languageSlug).toBeNull()
    expect(result?.pick.claimsLanguage).toBe(false)
  })

  it("prefers a slug-bearing dub over a slug-less one so rotation can progress", () => {
    const result = rotateLanguage(
      [dub(null), dub("spanish")],
      initialRotationState,
    )
    expect(result?.pick.languageSlug).toBe("spanish")
  })

  it("makes no claim when the language slug is known but the name is not", () => {
    const dubs = [
      dub("english"),
      dub("xyz", { language: { slug: "xyz", name: null } }),
    ]
    const first = rotateLanguage(dubs, initialRotationState)
    const second = rotateLanguage(dubs, first!.nextState)
    expect(second?.pick.languageSlug).toBe("xyz")
    expect(second?.pick.languageName).toBeNull()
    expect(second?.pick.claimsLanguage).toBe(false)
  })
})

// Excerpt windows (R6) are not language policy — they live in sourceResolution.ts
// and are covered by sourceResolution.test.ts.
