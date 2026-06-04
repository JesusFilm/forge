import { describe, expect, it } from "vitest"
import {
  buildLanguageDiagnosticRow,
  type LanguageDiagnosticSourceRow,
} from "@/app/dashboard/ops-data"

function sourceRow(
  overrides: Partial<LanguageDiagnosticSourceRow> = {},
): LanguageDiagnosticSourceRow {
  return {
    id: "lang_english",
    coreId: "529",
    source: "CORE" as LanguageDiagnosticSourceRow["source"],
    name: { en: "English" },
    bcp47: "en",
    iso3: "eng",
    slug: "english",
    audioPreviewValue: "https://cdn.example.com/en.mp3",
    audioPreviewDuration: 12,
    audioPreviewSize: 2048n,
    audioPreviewBitrate: 128,
    audioPreviewCodec: "mp3",
    syncedAt: new Date("2026-05-20T21:10:00.000Z"),
    createdAt: new Date("2026-05-19T21:10:00.000Z"),
    updatedAt: new Date("2026-05-20T21:10:00.000Z"),
    locales: [
      {
        id: "locale_en",
        locale: "en",
        value: "English",
        primary: true,
        order: 1,
      },
      {
        id: "locale_es",
        locale: "es",
        value: "Ingles",
        primary: false,
        order: 2,
      },
    ],
    countryLanguages: [
      {
        id: "country_language_us",
        coreId: "cl_us_en",
        speakers: 270000000,
        displaySpeakers: "270M",
        primary: true,
        suggested: true,
        order: 1,
        country: {
          id: "country_us",
          coreId: "US",
          name: { en: "United States" },
          flagPngSrc: "https://flags.example.com/us.png",
          flagWebpSrc: "https://flags.example.com/us.webp",
          continent: {
            coreId: "NA",
            name: { en: "North America" },
          },
        },
      },
    ],
    _count: {
      countryLanguages: 1,
      videoDubs: 2,
      videoSubtitles: 4,
      studyQuestions: 5,
      videosAsPrimary: 6,
    },
    ...overrides,
  }
}

describe("buildLanguageDiagnosticRow", () => {
  it("maps active Core language metadata into a serializable diagnostics row", () => {
    const row = buildLanguageDiagnosticRow(sourceRow())

    expect(row.title).toBe("English")
    expect(row.codeLabel).toBe("en / eng / english")
    expect(row.statusLabel).toBe("Linked")
    expect(row.syncLabel).toBe("Core synced")
    expect(row.flags).toMatchObject({
      linked: true,
      countryLinked: true,
      hasDubs: true,
      hasSubtitles: true,
      hasStudyQuestions: true,
      primaryVideoLanguage: true,
      hasAudioPreview: true,
      coreSynced: true,
      missingMetadata: false,
    })
    expect(row.counts.totalContentLinks).toBe(17)
    expect(row.audioPreview).toMatchObject({
      available: true,
      duration: "12s",
      size: "2.0 KB",
      bitrate: "128 kbps",
      codec: "mp3",
    })
    expect(row.countryPreviews[0]).toMatchObject({
      coreId: "US",
      label: "United States",
      continentLabel: "North America",
      flagUrl: "https://flags.example.com/us.webp",
      speakers: "270M",
      primary: true,
      suggested: true,
    })
    for (const term of [
      "lang_english",
      "529",
      "core",
      "english",
      "en / eng / english",
      "linked",
      "core synced",
      "has dubs",
      "has subtitles",
      "has study questions",
      "primary video language",
      "audio preview",
      "us",
      "united states",
      "north america",
      "270m",
    ]) {
      expect(row.searchText).toContain(term)
    }
    expect(row.searchText).not.toContain("cl_us_en")
  })

  it("surfaces missing metadata and non-Core provenance explicitly", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        id: "lang_custom",
        coreId: "custom",
        source: "MANAGER" as LanguageDiagnosticSourceRow["source"],
        name: {},
        bcp47: null,
        iso3: null,
        slug: null,
        audioPreviewValue: null,
        audioPreviewDuration: null,
        audioPreviewSize: null,
        audioPreviewBitrate: null,
        audioPreviewCodec: null,
        syncedAt: null,
        locales: [],
        countryLanguages: [],
        _count: {
          countryLanguages: 0,
          videoDubs: 0,
          videoSubtitles: 0,
          studyQuestions: 0,
          videosAsPrimary: 0,
        },
      }),
    )

    expect(row.title).toBe("custom")
    expect(row.codeLabel).toBe("No language codes")
    expect(row.statusLabel).toBe("Missing metadata")
    expect(row.syncLabel).toBe("Non-Core source")
    expect(row.flags).toMatchObject({
      referenceOnly: true,
      missingMetadata: true,
      countryLinked: false,
      hasAudioPreview: false,
      nonCoreSource: true,
    })
    expect(row.timestamps.syncedAt).toBe("None")
  })

  it("keeps all localized names available for detail display and search", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        locales: Array.from({ length: 13 }, (_, index) => ({
          id: `locale_${index}`,
          locale: `l${index}`,
          value: `Locale ${index}`,
          primary: index === 0,
          order: index,
        })),
      }),
    )

    expect(row.names).toContainEqual({
      locale: "l12",
      value: "Locale 12",
      primary: false,
    })
    expect(row.searchText).toContain("locale 12")
  })

  it("does not treat blank localized names as usable metadata", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        name: { en: "   " },
        locales: [
          {
            id: "blank",
            locale: "en",
            value: "   ",
            primary: true,
            order: 1,
          },
        ],
      }),
    )

    expect(row.names).toEqual([])
    expect(row.title).toBe("en")
    expect(row.flags.missingMetadata).toBe(true)
    expect(row.statusLabel).toBe("Missing metadata")
  })

  it("treats any audio preview metadata as audio preview availability", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        audioPreviewValue: null,
        audioPreviewDuration: 21,
        audioPreviewSize: null,
        audioPreviewBitrate: null,
        audioPreviewCodec: null,
      }),
    )

    expect(row.flags.hasAudioPreview).toBe(true)
    expect(row.audioPreview.available).toBe(true)
    expect(row.searchText).toContain("audio preview")
  })
})
