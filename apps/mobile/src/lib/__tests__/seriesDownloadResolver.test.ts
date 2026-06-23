import {
  decideEpisodeAction,
  resolveSeriesDownload,
  type SeriesResolveDeps,
} from "../seriesDownloadResolver"
import type { OfflineDownloadState } from "../offlineManifest"
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

describe("decideEpisodeAction", () => {
  const record = (dubDocumentId: string, state: OfflineDownloadState) => ({
    version: 1,
    videoSlug: "x",
    dubDocumentId,
    renditionDocumentId: "r",
    qualityLabel: "high",
    title: "",
    subtitleLanguageSlug: null,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 0,
  })

  it("starts when there is no record", () => {
    expect(decideEpisodeAction(null, "d1")).toBe("start")
  })

  it("starts a failed or canceled record regardless of language", () => {
    expect(decideEpisodeAction(record("d1", "failed"), "d1")).toBe("start")
    expect(decideEpisodeAction(record("d1", "canceled"), "d2")).toBe("start")
  })

  it("skips a same-language record in any non-terminal state", () => {
    expect(decideEpisodeAction(record("d1", "downloaded"), "d1")).toBe("skip")
    expect(decideEpisodeAction(record("d1", "downloading"), "d1")).toBe("skip")
  })

  it("swaps a downloaded record in a different language", () => {
    expect(decideEpisodeAction(record("d1", "downloaded"), "d2")).toBe("swap")
  })

  it("switches an in-progress different-language record (cancel + restart)", () => {
    expect(decideEpisodeAction(record("d1", "downloading"), "d2")).toBe(
      "switch",
    )
    expect(decideEpisodeAction(record("d1", "queued"), "d2")).toBe("switch")
    expect(decideEpisodeAction(record("d1", "paused"), "d2")).toBe("switch")
  })
})
