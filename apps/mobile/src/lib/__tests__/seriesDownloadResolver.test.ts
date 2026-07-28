import {
  decideEpisodeAction,
  deriveDownloadedSelection,
  episodeChoiceFor,
  resolveSeriesDownload,
  summarizeResolution,
  toResolverVariants,
  type EpisodeChoice,
  type SeriesEpisodeResolution,
  type SeriesResolveDeps,
} from "../seriesDownloadResolver"
import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "../offlineManifest"
import type { TieredDownload } from "../downloadTiers"
import type {
  VariantMedia,
  WatchDownload,
  WatchEpisode,
  WatchSubtitle,
  WatchVariant,
} from "../normalizeVideo"

const episode = (slug: string): WatchEpisode => ({
  documentId: `${slug}-doc`,
  slug,
  label: null,
  title: `Title ${slug}`,
  posterUrl: `poster-${slug}`,
})

const variant = (languageSlug: string, documentId: string): WatchVariant => ({
  documentId,
  slug: `${documentId}-slug`,
  published: true,
  hls: "hls://x",
  duration: 100,
  languageCoreId: null,
  languageBcp47: null,
  languageSlug,
  languageName: languageSlug,
  languageNameNative: null,
  muxPlaybackId: null,
})

const dl = (
  documentId: string,
  quality: string,
  size: string,
): WatchDownload => ({
  documentId,
  quality,
  size,
  url: `url-${documentId}`,
})

const sub = (languageSlug: string): WatchSubtitle => ({
  documentId: `sub-${languageSlug}`,
  languageSlug,
  languageName: languageSlug,
  languageBcp47: "",
  vttSrc: `vtt-${languageSlug}`,
  primary: false,
  aiGenerated: false,
})

const media = (
  downloads: WatchDownload[],
  subtitles: WatchSubtitle[] = [],
): VariantMedia => ({ downloads, subtitles })

const threeTier = (dubId: string) =>
  media([
    dl(`${dubId}-hi`, "high", "3000"),
    dl(`${dubId}-mid`, "mid", "2000"),
    dl(`${dubId}-lo`, "low", "1000"),
  ])

describe("resolveSeriesDownload", () => {
  it("resolves every episode and sums the chosen-tier sizes", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [
        variant("es", `${slug}-es`),
        variant("en", `${slug}-en`),
      ],
      getDubMedia: async (dubId) => threeTier(dubId),
    }
    const res = await resolveSeriesDownload(
      [episode("a"), episode("b")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolvedCount).toBe(2)
    expect(res.totalBytes).toBe(6000)
    expect(res.totalIsLowerBound).toBe(false)
    expect(res.resolved[0].resolvedTier).toBe("Highest")
    expect(res.resolved[0].rendition?.size).toBe("3000")
  })

  it("totals every tier across the resolved set (for the quality picker hints)", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      getDubMedia: async (dubId) => threeTier(dubId), // Highest 3000/High 2000/Low 1000
    }
    const res = await resolveSeriesDownload(
      [episode("a"), episode("b")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    // Two episodes — the tier totals are independent of the selected tier.
    expect(res.tierTotals.Highest.bytes).toBe(6000)
    expect(res.tierTotals.High.bytes).toBe(4000)
    expect(res.tierTotals.Low.bytes).toBe(2000)
    expect(res.tierTotals.Highest.isLowerBound).toBe(false)
    // The selected tier's total equals the resolution totalBytes.
    expect(res.tierTotals.Highest.bytes).toBe(res.totalBytes)
  })

  it("tier totals use the same nearest fallback as the download", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      // Only two renditions → tiers [Highest 3000, Low 1000]; "High" must fall back.
      getDubMedia: async (dubId) =>
        media([
          dl(`${dubId}-hi`, "high", "3000"),
          dl(`${dubId}-lo`, "low", "1000"),
        ]),
    }
    const res = await resolveSeriesDownload(
      [episode("a")],
      { qualityTier: "Low", languageSlug: "es", subtitleLanguageSlug: null },
      deps,
    )
    expect(res.tierTotals.Highest.bytes).toBe(3000)
    expect(res.tierTotals.High.bytes).toBe(3000) // ties prefer higher quality
    expect(res.tierTotals.Low.bytes).toBe(1000)
  })

  it("marks a tier lower-bound when an episode lacks a size for it", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      getDubMedia: async (dubId) =>
        media([
          dl(`${dubId}-hi`, "high", "3000"),
          dl(`${dubId}-lo`, "low", "0"), // unknown size → Low tier
        ]),
    }
    const res = await resolveSeriesDownload(
      [episode("a")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.tierTotals.Highest).toEqual({ bytes: 3000, isLowerBound: false })
    expect(res.tierTotals.Low).toEqual({ bytes: 0, isLowerBound: true })
  })

  it("skips an episode lacking the chosen language without failing it", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) =>
        slug === "b" ? [variant("en", "b-en")] : [variant("es", `${slug}-es`)],
      getDubMedia: async (dubId) => threeTier(dubId),
    }
    const res = await resolveSeriesDownload(
      [episode("a"), episode("b")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolvedCount).toBe(1)
    expect(res.skippedLanguageCount).toBe(1)
    expect(res.episodes.find((e) => e.slug === "b")?.status).toBe(
      "skipped-language-absent",
    )
  })

  it("selects by tier label with nearest fallback, never a positional index", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      // Only two renditions → tiers are [Highest, Low]; "High" must fall back.
      getDubMedia: async (dubId) =>
        media([
          dl(`${dubId}-hi`, "high", "3000"),
          dl(`${dubId}-lo`, "low", "1000"),
        ]),
    }
    const res = await resolveSeriesDownload(
      [episode("a")],
      { qualityTier: "High", languageSlug: "es", subtitleLanguageSlug: null },
      deps,
    )
    expect(res.resolvedCount).toBe(1)
    expect(res.resolved[0].rendition).toBeDefined()
    expect(["Highest", "Low"]).toContain(res.resolved[0].resolvedTier)
  })

  it("marks an episode with no downloadable rendition as skipped-no-rendition", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async () => [variant("es", "a-es")],
      getDubMedia: async () => media([]),
    }
    const res = await resolveSeriesDownload(
      [episode("a")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.skippedNoRenditionCount).toBe(1)
    expect(res.episodes[0].status).toBe("skipped-no-rendition")
  })

  it("resolves with subtitleMissing when the chosen subtitle track is absent", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async () => [variant("es", "a-es")],
      getDubMedia: async () => media([dl("hi", "high", "2000")], [sub("es")]),
    }
    const res = await resolveSeriesDownload(
      [episode("a")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: "fr",
      },
      deps,
    )
    expect(res.resolvedCount).toBe(1)
    expect(res.resolved[0].subtitleMissing).toBe(true)
    expect(res.resolved[0].subtitleUrl).toBeNull()
  })

  it("flags the total as a lower bound when a resolved size is zero", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async () => [variant("es", "a-es")],
      getDubMedia: async () => media([dl("z", "high", "0")]),
    }
    const res = await resolveSeriesDownload(
      [episode("a")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolvedCount).toBe(1)
    expect(res.totalBytes).toBe(0)
    expect(res.totalIsLowerBound).toBe(true)
    expect(res.resolved[0].sizeUnknown).toBe(true)
  })

  // U1: seriesEpisodeIndex/durationSeconds are PER-EPISODE — carried from the
  // input WatchEpisode straight onto the resolution (not synthesized here).
  it("carries seriesEpisodeIndex and durationSeconds from the input episode", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      getDubMedia: async (dubId) => threeTier(dubId),
    }
    const withIndex: WatchEpisode = {
      ...episode("a"),
      seriesEpisodeIndex: 3,
      durationSeconds: 725,
    }
    const res = await resolveSeriesDownload(
      [withIndex],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolved[0].seriesEpisodeIndex).toBe(3)
    expect(res.resolved[0].durationSeconds).toBe(725)
  })

  it("round-trips seriesEpisodeIndex: 0 without conflating it with absent", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => [variant("es", `${slug}-es`)],
      getDubMedia: async (dubId) => threeTier(dubId),
    }
    const zeroIndex: WatchEpisode = { ...episode("a"), seriesEpisodeIndex: 0 }
    const res = await resolveSeriesDownload(
      [zeroIndex],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolved[0].seriesEpisodeIndex).toBe(0)
  })

  it("maps a fetch error to failed-resolve without dropping siblings", async () => {
    const deps: SeriesResolveDeps = {
      getEpisodeVariants: async (slug) => {
        if (slug === "b") throw new Error("network")
        return [variant("es", `${slug}-es`)]
      },
      getDubMedia: async (dubId) => threeTier(dubId),
    }
    const res = await resolveSeriesDownload(
      [episode("a"), episode("b")],
      {
        qualityTier: "Highest",
        languageSlug: "es",
        subtitleLanguageSlug: null,
      },
      deps,
    )
    expect(res.resolvedCount).toBe(1)
    expect(res.failedCount).toBe(1)
    expect(res.episodes.find((e) => e.slug === "b")?.status).toBe(
      "failed-resolve",
    )
  })
})

describe("summarizeResolution", () => {
  const ep = (
    slug: string,
    status: SeriesEpisodeResolution["status"],
    extra: Partial<SeriesEpisodeResolution> = {},
  ): SeriesEpisodeResolution => ({
    slug,
    title: `Title ${slug}`,
    posterUrl: null,
    status,
    ...extra,
  })

  it("rolls up counts, total bytes, and the lower-bound flag", () => {
    const summary = summarizeResolution([
      ep("a", "resolved", { sizeBytes: 1000, sizeUnknown: false }),
      ep("b", "resolved", { sizeBytes: 2000, sizeUnknown: false }),
      ep("c", "skipped-language-absent"),
      ep("d", "skipped-no-rendition"),
      ep("e", "failed-resolve"),
    ])
    expect(summary.resolvedCount).toBe(2)
    expect(summary.resolved.map((r) => r.slug)).toEqual(["a", "b"])
    expect(summary.skippedLanguageCount).toBe(1)
    expect(summary.skippedNoRenditionCount).toBe(1)
    expect(summary.failedCount).toBe(1)
    expect(summary.totalBytes).toBe(3000)
    expect(summary.totalIsLowerBound).toBe(false)
  })

  it("flags the total as a lower bound when any resolved size is unknown", () => {
    const summary = summarizeResolution([
      ep("a", "resolved", { sizeBytes: 1000, sizeUnknown: false }),
      ep("b", "resolved", { sizeBytes: 0, sizeUnknown: true }),
    ])
    expect(summary.totalBytes).toBe(1000)
    expect(summary.totalIsLowerBound).toBe(true)
  })
})

describe("decideEpisodeAction", () => {
  const record = (
    dubDocumentId: string,
    state: OfflineDownloadState,
    renditionDocumentId = "r",
    subtitleLanguageSlug: string | null = null,
  ) => ({
    version: 1,
    videoSlug: "x",
    dubDocumentId,
    renditionDocumentId,
    qualityLabel: "high",
    title: "",
    subtitleLanguageSlug,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 0,
  })
  const choice = (
    dubDocumentId: string,
    renditionDocumentId = "r",
    subtitleLanguageSlug: string | null = null,
  ): EpisodeChoice => ({
    dubDocumentId,
    renditionDocumentId,
    subtitleLanguageSlug,
  })

  it("starts when there is no record", () => {
    expect(decideEpisodeAction(null, choice("d1"))).toBe("start")
  })

  it("starts a failed or canceled record regardless of choice", () => {
    expect(decideEpisodeAction(record("d1", "failed"), choice("d1"))).toBe(
      "start",
    )
    expect(decideEpisodeAction(record("d1", "canceled"), choice("d2"))).toBe(
      "start",
    )
  })

  it("skips a record matching dub + rendition + subtitle", () => {
    expect(decideEpisodeAction(record("d1", "downloaded"), choice("d1"))).toBe(
      "skip",
    )
    expect(decideEpisodeAction(record("d1", "downloading"), choice("d1"))).toBe(
      "skip",
    )
  })

  it("swaps a downloaded record in a different language", () => {
    expect(decideEpisodeAction(record("d1", "downloaded"), choice("d2"))).toBe(
      "swap",
    )
  })

  it("swaps a downloaded record when only the quality (rendition) changed", () => {
    expect(
      decideEpisodeAction(record("d1", "downloaded", "r1"), choice("d1", "r2")),
    ).toBe("swap")
  })

  it("swaps a downloaded record when only the subtitle changed", () => {
    expect(
      decideEpisodeAction(
        record("d1", "downloaded", "r", null),
        choice("d1", "r", "es"),
      ),
    ).toBe("swap")
    // ...and dropping a subtitle from a subtitled copy is also a change.
    expect(
      decideEpisodeAction(
        record("d1", "downloaded", "r", "es"),
        choice("d1", "r", null),
      ),
    ).toBe("swap")
  })

  it("switches an in-progress record differing on dub, quality, or subtitle", () => {
    expect(decideEpisodeAction(record("d1", "downloading"), choice("d2"))).toBe(
      "switch",
    )
    expect(decideEpisodeAction(record("d1", "queued"), choice("d2"))).toBe(
      "switch",
    )
    expect(
      decideEpisodeAction(record("d1", "paused", "r1"), choice("d1", "r2")),
    ).toBe("switch")
  })
})

describe("episodeChoiceFor (lockstep with buildEpisodeRequest)", () => {
  const resolved = (
    subtitleUrl: string | null,
    overrides: Partial<SeriesEpisodeResolution> = {},
  ): SeriesEpisodeResolution => ({
    slug: "a",
    title: "a",
    posterUrl: null,
    status: "resolved",
    dubDocumentId: "dub-a",
    rendition: {
      documentId: "r-hi",
      quality: "Highest",
      size: "1000",
      url: "u",
    },
    resolvedTier: "Highest",
    subtitleUrl,
    sizeBytes: 1000,
    sizeUnknown: false,
    ...overrides,
  })

  it("carries the chosen subtitle slug when the episode HAS that track", () => {
    expect(episodeChoiceFor(resolved("https://sub.vtt"), "ja")).toEqual({
      dubDocumentId: "dub-a",
      renditionDocumentId: "r-hi",
      subtitleLanguageSlug: "ja",
    })
  })

  it("degrades subtitle to null when the episode lacks that track (subtitleUrl null)", () => {
    // The degrade rule that MUST stay in lockstep with buildEpisodeRequest — an
    // absent track saves null so the enqueue/gate treat re-picking it as a no-op.
    expect(
      episodeChoiceFor(resolved(null), "ja")?.subtitleLanguageSlug,
    ).toBeNull()
  })

  it("returns null for a non-resolved or rendition-less episode", () => {
    expect(
      episodeChoiceFor(
        resolved(null, {
          status: "skipped-no-rendition",
          rendition: undefined,
        }),
        "ja",
      ),
    ).toBeNull()
    expect(
      episodeChoiceFor(resolved(null, { dubDocumentId: undefined }), null),
    ).toBeNull()
  })
})

describe("toResolverVariants (lean dub-index mapper)", () => {
  it("keeps only published dubs, mirroring normalizeVideo's gate", () => {
    const variants = toResolverVariants([
      { documentId: "d1", published: true, language: { slug: "en" } },
      { documentId: "d2", published: false, language: { slug: "ja" } },
      { documentId: "d3", published: null, language: { slug: "fr" } },
    ])
    expect(variants).toEqual([{ documentId: "d1", languageSlug: "en" }])
  })

  it("defaults missing ids and language slugs safely", () => {
    const variants = toResolverVariants([
      { documentId: null, published: true, language: null },
    ])
    expect(variants).toEqual([{ documentId: "", languageSlug: null }])
  })

  it("returns empty for a null/undefined dub list", () => {
    expect(toResolverVariants(null)).toEqual([])
    expect(toResolverVariants(undefined)).toEqual([])
  })
})

describe("deriveDownloadedSelection", () => {
  const tier = (
    documentId: string,
    t: TieredDownload["tier"],
  ): TieredDownload => ({
    documentId,
    quality: t,
    size: "1000",
    url: `u-${documentId}`,
    tier: t,
  })
  // A resolved episode carrying the full tier set (each tier's rendition id).
  const ep = (slug: string, dub: string): SeriesEpisodeResolution => ({
    slug,
    title: slug,
    posterUrl: null,
    status: "resolved",
    dubDocumentId: dub,
    tiered: [tier(`${slug}-hi`, "Highest"), tier(`${slug}-lo`, "Low")],
    rendition: tier(`${slug}-hi`, "Highest"),
    resolvedTier: "Highest",
    sizeBytes: 1000,
    sizeUnknown: false,
  })
  const rec = (
    dub: string,
    renditionDocumentId: string,
    subtitleLanguageSlug: string | null,
    state: OfflineDownloadState = "downloaded",
  ): OfflineDownloadRecord => ({
    version: 1,
    videoSlug: "x",
    dubDocumentId: dub,
    renditionDocumentId,
    qualityLabel: "q",
    title: "",
    subtitleLanguageSlug,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 0,
  })
  const resolutionOf = (eps: SeriesEpisodeResolution[]) =>
    summarizeResolution(eps)

  it("returns the shared tier + subtitle when every episode matches", () => {
    const resolution = resolutionOf([ep("a", "dub"), ep("b", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-lo", "ja"),
      b: rec("dub", "b-lo", "ja"),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: "Low", subtitleSlug: "ja" })
  })

  it("has no subtitle to disable when saved without subtitles", () => {
    const resolution = resolutionOf([ep("a", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-hi", null),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: "Highest", subtitleSlug: undefined })
  })

  it("detects the subtitle language even when some episodes lack that track", () => {
    // The user's case: saved with Japanese; 'a' has the track (sub=ja), 'b'
    // doesn't offer Japanese so it saved as null. Japanese is still the choice.
    const resolution = resolutionOf([ep("a", "dub"), ep("b", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-hi", "ja"),
      b: rec("dub", "b-hi", null),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: "Highest", subtitleSlug: "ja" })
  })

  it("disables nothing for a PARTIAL series (not every episode saved)", () => {
    // 2 episodes uniformly at Low/no-sub — but only one is actually saved. The
    // user must still be able to pick Low to finish the missing episode.
    const resolution = resolutionOf([ep("a", "dub"), ep("b", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-lo", null),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: null, subtitleSlug: undefined })
  })

  it("disables nothing when the series isn't downloaded", () => {
    const resolution = resolutionOf([ep("a", "dub")])
    const sel = deriveDownloadedSelection(resolution, () => null)
    expect(sel).toEqual({ tier: null, subtitleSlug: undefined })
  })

  it("returns null tier for a mixed-tier set (don't guess)", () => {
    const resolution = resolutionOf([ep("a", "dub"), ep("b", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-hi", null), // Highest
      b: rec("dub", "b-lo", null), // Low
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: null, subtitleSlug: undefined })
  })

  it("returns undefined subtitle when episodes saved with DIFFERENT languages", () => {
    const resolution = resolutionOf([ep("a", "dub"), ep("b", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-hi", "ja"),
      b: rec("dub", "b-hi", "en"),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: "Highest", subtitleSlug: undefined })
  })

  it("ignores a record downloaded in a different audio language", () => {
    const resolution = resolutionOf([ep("a", "dub-current")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub-OTHER", "a-lo", "ja"),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: null, subtitleSlug: undefined })
  })

  it("ignores an in-progress (not yet committed) record", () => {
    const resolution = resolutionOf([ep("a", "dub")])
    const records: Record<string, OfflineDownloadRecord> = {
      a: rec("dub", "a-lo", "ja", "downloading"),
    }
    const sel = deriveDownloadedSelection(resolution, (s) => records[s] ?? null)
    expect(sel).toEqual({ tier: null, subtitleSlug: undefined })
  })
})
