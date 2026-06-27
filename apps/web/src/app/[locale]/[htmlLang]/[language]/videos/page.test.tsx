/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import LanguageVideosPage, {
  generateMetadata,
} from "@/app/[locale]/[htmlLang]/[language]/videos/page"

const spanishLanguage = {
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
}

vi.mock("@/lib/language-index", () => ({
  getWatchLanguageIndexLanguage: vi.fn(async (publicSlug: string) =>
    publicSlug === "spanish-latin-american" ? spanishLanguage : null,
  ),
}))

describe("/{language}.html/videos route", () => {
  it("renders the language-scoped videos page", async () => {
    const page = await LanguageVideosPage({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        language: "spanish-latin-american.html",
      }),
    })

    const html = renderToString(page)
    expect(html).toContain("Spanish, Latin American")
    expect(html).toContain("Español latinoamericano")
    expect(html).toContain("/languages")
  })

  it("declares canonical URL with language.html/videos shape", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        language: "spanish-latin-american.html",
      }),
    })

    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/spanish-latin-american.html/videos",
    )
  })
})
