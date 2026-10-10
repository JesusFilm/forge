import { describe, expect, it } from "vitest"
import type { LanguageDiagnosticRow } from "@/app/dashboard/ops-data"
import {
  countryLinkOverflowLabel,
  filterLanguageRows,
  matchesLanguageSearch,
  type LanguageDiagnosticFilters,
} from "@/app/dashboard/languages/language-diagnostics"

function diagnosticRow(
  overrides: Partial<LanguageDiagnosticRow>,
): LanguageDiagnosticRow {
  return {
    id: "lang_en",
    coreId: "529",
    source: "CORE",
    title: "English",
    subtitle: "en / eng / english",
    codeLabel: "en / eng / english",
    bcp47: "en",
    iso3: "eng",
    slug: "english",
    statusLabel: "Linked",
    statusTone: "success",
    syncLabel: "Core synced",
    syncTone: "success",
    names: [{ locale: "en", value: "English", primary: true }],
    countryPreviews: [
      {
        id: "cl_us",
        coreId: "US",
        label: "United States",
        continentLabel: "North America",
        flagUrl: "https://flags.example.com/us.webp",
        speakers: "270M",
        primary: true,
        suggested: true,
        order: 1,
      },
    ],
    counts: {
      countryLanguages: 1,
      videoDubs: 2,
      videoSubtitles: 4,
      studyQuestions: 5,
      primaryVideos: 6,
      totalContentLinks: 17,
    },
    audioPreview: {
      available: true,
      value: "https://cdn.example.com/en.mp3",
      duration: "12s",
      size: "2.0 KB",
      bitrate: "128 kbps",
      codec: "mp3",
    },
    timestamps: {
      createdAt: "05/19/2026, 21:10",
      createdAtIso: "2026-05-19T21:10:00.000Z",
      updatedAt: "05/20/2026, 21:10",
      updatedAtIso: "2026-05-20T21:10:00.000Z",
      syncedAt: "05/20/2026, 21:10",
      syncedAtIso: "2026-05-20T21:10:00.000Z",
    },
    flags: {
      linked: true,
      referenceOnly: false,
      missingMetadata: false,
      countryLinked: true,
      hasDubs: true,
      hasSubtitles: true,
      hasStudyQuestions: true,
      primaryVideoLanguage: true,
      hasAudioPreview: true,
      coreSynced: true,
      syncMissing: false,
      updatedAfterSync: false,
      nonCoreSource: false,
    },
    searchText:
      "lang_en 529 core english en eng english linked core synced united states has dubs has subtitles",
    ...overrides,
  }
}

describe("language diagnostics filtering", () => {
  it("matches every search token against the row search index", () => {
    const row = diagnosticRow({})

    expect(matchesLanguageSearch(row, "english united")).toBe(true)
    expect(matchesLanguageSearch(row, "english missing")).toBe(false)
  })

  it("ANDs search with operational, geo/content, and sync filters", () => {
    const rows = [
      diagnosticRow({}),
      diagnosticRow({
        id: "lang_es",
        coreId: "21028",
        title: "Spanish",
        subtitle: "es / spa / spanish",
        codeLabel: "es / spa / spanish",
        statusLabel: "Reference only",
        statusTone: "muted",
        syncLabel: "Sync missing",
        syncTone: "warning",
        names: [{ locale: "en", value: "Spanish", primary: true }],
        countryPreviews: [],
        counts: {
          countryLanguages: 0,
          videoDubs: 0,
          videoSubtitles: 0,
          studyQuestions: 0,
          primaryVideos: 0,
          totalContentLinks: 0,
        },
        audioPreview: {
          available: false,
          value: null,
          duration: null,
          size: null,
          bitrate: null,
          codec: null,
        },
        flags: {
          linked: false,
          referenceOnly: true,
          missingMetadata: false,
          countryLinked: false,
          hasDubs: false,
          hasSubtitles: false,
          hasStudyQuestions: false,
          primaryVideoLanguage: false,
          hasAudioPreview: false,
          coreSynced: false,
          syncMissing: true,
          updatedAfterSync: false,
          nonCoreSource: false,
        },
        searchText:
          "lang_es 21028 core spanish es spa spanish reference only sync missing no country links",
      }),
    ]
    const filters: LanguageDiagnosticFilters = {
      operational: "reference-only",
      geoContent: "no-country-links",
      sync: "sync-missing",
    }

    expect(
      filterLanguageRows(rows, "spanish", filters).map((row) => row.id),
    ).toEqual(["lang_es"])
    expect(filterLanguageRows(rows, "english", filters)).toEqual([])
  })

  it("matches every non-all filter option against its diagnostic flag", () => {
    const allFilters: LanguageDiagnosticFilters = {
      operational: "all",
      geoContent: "all",
      sync: "all",
    }
    const cases: Array<{
      label: string
      filters: LanguageDiagnosticFilters
      flag: keyof LanguageDiagnosticRow["flags"]
      positiveValue: boolean
      negativeValue: boolean
    }> = [
      {
        label: "linked",
        filters: { ...allFilters, operational: "linked" },
        flag: "linked",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "reference only",
        filters: { ...allFilters, operational: "reference-only" },
        flag: "referenceOnly",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "missing metadata",
        filters: { ...allFilters, operational: "missing-metadata" },
        flag: "missingMetadata",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "country linked",
        filters: { ...allFilters, geoContent: "country-linked" },
        flag: "countryLinked",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "no country links",
        filters: { ...allFilters, geoContent: "no-country-links" },
        flag: "countryLinked",
        positiveValue: false,
        negativeValue: true,
      },
      {
        label: "has dubs",
        filters: { ...allFilters, geoContent: "has-dubs" },
        flag: "hasDubs",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "has subtitles",
        filters: { ...allFilters, geoContent: "has-subtitles" },
        flag: "hasSubtitles",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "has study questions",
        filters: { ...allFilters, geoContent: "has-study-questions" },
        flag: "hasStudyQuestions",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "primary video language",
        filters: { ...allFilters, geoContent: "primary-video-language" },
        flag: "primaryVideoLanguage",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "audio preview",
        filters: { ...allFilters, geoContent: "audio-preview" },
        flag: "hasAudioPreview",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "core synced",
        filters: { ...allFilters, sync: "core-synced" },
        flag: "coreSynced",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "sync missing",
        filters: { ...allFilters, sync: "sync-missing" },
        flag: "syncMissing",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "updated after sync",
        filters: { ...allFilters, sync: "updated-after-sync" },
        flag: "updatedAfterSync",
        positiveValue: true,
        negativeValue: false,
      },
      {
        label: "non-Core source",
        filters: { ...allFilters, sync: "non-core-source" },
        flag: "nonCoreSource",
        positiveValue: true,
        negativeValue: false,
      },
    ]

    for (const item of cases) {
      const baseFlags = diagnosticRow({}).flags
      const rows = [
        diagnosticRow({
          id: `${item.label}-positive`,
          flags: { ...baseFlags, [item.flag]: item.positiveValue },
        }),
        diagnosticRow({
          id: `${item.label}-negative`,
          flags: { ...baseFlags, [item.flag]: item.negativeValue },
        }),
      ]

      expect(
        filterLanguageRows(rows, "", item.filters).map((row) => row.id),
      ).toEqual([`${item.label}-positive`])
    }
  })

  it("summarizes bounded country preview overflow", () => {
    const row = diagnosticRow({
      counts: {
        countryLanguages: 3,
        videoDubs: 2,
        videoSubtitles: 4,
        studyQuestions: 5,
        primaryVideos: 6,
        totalContentLinks: 17,
      },
    })

    expect(countryLinkOverflowLabel(row)).toBe(
      "Showing first 1 of 3 country links.",
    )
    expect(
      countryLinkOverflowLabel(
        diagnosticRow({
          counts: { ...row.counts, countryLanguages: 1 },
        }),
      ),
    ).toBeNull()
  })
})
