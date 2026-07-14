/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import LanguagesPage, {
  metadata,
} from "@/app/[locale]/[htmlLang]/languages/page"

vi.mock("@/lib/language-index", () => ({
  getWatchLanguageIndex: vi.fn(async () => ({
    languages: [
      {
        id: "lang-es-419",
        coreId: "529",
        englishLabel: "Spanish, Latin American",
        nativeLabel: "Español latinoamericano",
        publicSlug: "spanish-latin-american",
        href: "/spanish-latin-american.html/videos",
        bcp47: "es-419",
        speakerCount: 80_000_000,
        regionNames: ["North America"],
        flagPngSrc: "https://example.test/mx.png",
      },
    ],
    regions: [
      {
        name: "North America",
        languages: [
          {
            id: "lang-es-419",
            coreId: "529",
            englishLabel: "Spanish, Latin American",
            nativeLabel: "Español latinoamericano",
            publicSlug: "spanish-latin-american",
            href: "/spanish-latin-american.html/videos",
            bcp47: "es-419",
            speakerCount: 80_000_000,
            regionNames: ["North America"],
            flagPngSrc: "https://example.test/mx.png",
          },
        ],
        countries: [
          {
            id: "mx",
            coreId: "MX",
            name: "Mexico",
            flagPngSrc: "https://example.test/mx.png",
            speakerCount: 80_000_000,
            languageSpeakerCounts: {
              "spanish-latin-american": 80_000_000,
            },
            languages: [
              {
                id: "lang-es-419",
                coreId: "529",
                englishLabel: "Spanish, Latin American",
                nativeLabel: "Español latinoamericano",
                publicSlug: "spanish-latin-american",
                href: "/spanish-latin-american.html/videos",
                bcp47: "es-419",
                speakerCount: 80_000_000,
                regionNames: ["North America"],
                flagPngSrc: "https://example.test/mx.png",
              },
            ],
          },
        ],
      },
    ],
  })),
}))

describe("/languages route", () => {
  it("renders 200 with language index links", async () => {
    const page = await LanguagesPage({
      params: Promise.resolve({ locale: "en", htmlLang: "en" }),
    })
    const html = renderToString(page)
    expect(html).toContain("Choose a language")
    expect(html).toContain("Spanish, Latin American")
    expect(html).toContain("/spanish-latin-american.html/videos")
  })

  it("declares canonical URL with .html-free /languages shape", () => {
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/languages",
    )
  })

  it("does not include .html suffix in canonical (production contract)", () => {
    const canonical = metadata.alternates?.canonical
    expect(String(canonical)).not.toContain(".html")
  })
})
