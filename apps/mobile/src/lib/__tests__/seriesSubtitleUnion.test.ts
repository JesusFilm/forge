import {
  resolveSeriesSubtitleUnion,
  type SubtitleUnionDeps,
} from "../seriesSubtitleUnion"
import type {
  VariantMedia,
  WatchSubtitle,
  WatchVariant,
} from "../normalizeVideo"

function sub(languageSlug: string, languageName: string): WatchSubtitle {
  return {
    documentId: `sub-${languageSlug}`,
    languageSlug,
    languageName,
    languageBcp47: languageSlug,
    vttSrc: `https://example.test/${languageSlug}.vtt`,
    primary: false,
    aiGenerated: false,
  }
}

// `dubId` lets two episodes share an audio language but resolve to distinct dubs.
function variant(
  languageSlug: string,
  dubId = `dub-${languageSlug}`,
): WatchVariant {
  return {
    documentId: dubId,
    slug: `slug-${dubId}`,
    published: true,
    hls: null,
    duration: null,
    languageCoreId: null,
    languageBcp47: languageSlug,
    languageSlug,
    languageName: languageSlug,
    languageNameNative: null,
    muxPlaybackId: null,
  }
}

function media(subtitles: WatchSubtitle[]): VariantMedia {
  return { downloads: [], subtitles }
}

function deps(
  variantsBySlug: Record<string, WatchVariant[]>,
  mediaByDub: Record<string, VariantMedia>,
): SubtitleUnionDeps {
  return {
    getEpisodeVariants: async (slug) => variantsBySlug[slug] ?? [],
    getDubMedia: async (id) => mediaByDub[id] ?? media([]),
  }
}

describe("resolveSeriesSubtitleUnion", () => {
  it("dedupes subtitle languages that repeat across episodes and sorts by name", async () => {
    const d = deps(
      { e1: [variant("en", "dub-1")], e2: [variant("en", "dub-2")] },
      {
        "dub-1": media([sub("fr", "French"), sub("es", "Spanish")]),
        "dub-2": media([sub("fr", "French")]),
      },
    )
    const result = await resolveSeriesSubtitleUnion(
      [{ slug: "e1" }, { slug: "e2" }],
      "en",
      d,
    )
    expect(result.failedEpisodes).toBe(0)
    // "fr" appears in both episodes but only once; sorted French, Spanish.
    expect(result.subtitles.map((s) => s.languageSlug)).toEqual(["fr", "es"])
  })

  it("unions distinct subtitle languages from different episodes", async () => {
    const d = deps(
      { e1: [variant("en", "dub-1")], e2: [variant("en", "dub-2")] },
      {
        "dub-1": media([sub("fr", "French")]),
        "dub-2": media([sub("de", "German")]),
      },
    )
    const result = await resolveSeriesSubtitleUnion(
      [{ slug: "e1" }, { slug: "e2" }],
      "en",
      d,
    )
    // Sorted by display name: French (fr) before German (de).
    expect(result.subtitles.map((s) => s.languageSlug)).toEqual(["fr", "de"])
  })

  it("skips an episode that lacks the chosen audio language (no error)", async () => {
    const d = deps(
      { e1: [variant("en", "dub-1")], e2: [variant("ru", "dub-2")] },
      {
        "dub-1": media([sub("fr", "French")]),
        "dub-2": media([sub("ru", "Russian")]),
      },
    )
    const result = await resolveSeriesSubtitleUnion(
      [{ slug: "e1" }, { slug: "e2" }],
      "en",
      d,
    )
    // Only e1 (which has the "en" variant) contributes; e2 is skipped silently.
    expect(result.failedEpisodes).toBe(0)
    expect(result.subtitles.map((s) => s.languageSlug)).toEqual(["fr"])
  })

  it("counts a thrown episode fetch as failed without failing the batch", async () => {
    const d: SubtitleUnionDeps = {
      getEpisodeVariants: async (slug) => {
        if (slug === "bad") throw new Error("network")
        return [variant("en", "dub-1")]
      },
      getDubMedia: async () => media([sub("fr", "French")]),
    }
    const result = await resolveSeriesSubtitleUnion(
      [{ slug: "ok" }, { slug: "bad" }],
      "en",
      d,
    )
    expect(result.failedEpisodes).toBe(1)
    expect(result.subtitles.map((s) => s.languageSlug)).toEqual(["fr"])
  })

  it("returns an empty union when no episode offers subtitles", async () => {
    const d = deps({ e1: [variant("en", "dub-1")] }, { "dub-1": media([]) })
    const result = await resolveSeriesSubtitleUnion([{ slug: "e1" }], "en", d)
    expect(result.subtitles).toEqual([])
    expect(result.failedEpisodes).toBe(0)
  })

  it("counts an episode that exceeds the per-episode timeout as failed", async () => {
    jest.useFakeTimers()
    try {
      const d: SubtitleUnionDeps = {
        // Never resolves → the per-episode timeout is the only way it settles.
        getEpisodeVariants: () => new Promise<WatchVariant[]>(() => {}),
        getDubMedia: async () => media([]),
      }
      const promise = resolveSeriesSubtitleUnion(
        [{ slug: "slow" }],
        "en",
        d,
        undefined,
        50,
      )
      await jest.advanceTimersByTimeAsync(60)
      const result = await promise
      expect(result.failedEpisodes).toBe(1)
      expect(result.subtitles).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })
})
