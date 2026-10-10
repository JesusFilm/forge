/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { WatchLanguageIndexLanguage } from "@/lib/language-index"

import { WatchLanguageIndexBrowser } from "./WatchLanguageIndexBrowser"

type TestLanguageOverrides = Partial<WatchLanguageIndexLanguage>

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  container?.remove()
  container = null
  root = null
})

function language(index: number, overrides: TestLanguageOverrides = {}) {
  const publicSlug = overrides.publicSlug ?? `language-${index}`
  return {
    id: `lang-${index}`,
    coreId: `${index}`,
    englishLabel: `Language ${index}`,
    nativeLabel: `Native ${index}`,
    publicSlug,
    aliasOwnerSlug: publicSlug,
    href: `/language-${index}.html/videos`,
    bcp47: "fr",
    speakerCount: 10_000 - index,
    regionNames: ["Africa"],
    flagPngSrc: null,
    ...overrides,
  }
}

function languageSpeakerCounts(
  languages: WatchLanguageIndexLanguage[],
): Record<string, number> {
  return Object.fromEntries(
    languages.map((language) => [language.publicSlug, language.speakerCount]),
  )
}

function renderBrowser(props: Parameters<typeof WatchLanguageIndexBrowser>[0]) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<WatchLanguageIndexBrowser {...props} />)
  })
  return container
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function countrySections(html: HTMLElement): HTMLElement[] {
  return Array.from(
    html.querySelectorAll('section[aria-label$=" languages"]'),
  ) as HTMLElement[]
}

function searchLanguages(html: HTMLElement, value: string) {
  const input = html.querySelector('input[type="search"]')
  act(() => {
    if (input instanceof HTMLInputElement) {
      setInputValue(input, value)
    }
  })
}

describe("WatchLanguageIndexBrowser", () => {
  it("keeps the search controls above the composited input", () => {
    const html = renderBrowser({ regions: [] })
    const searchIcon = html.querySelector("svg.lucide-search")
    const input = html.querySelector('input[type="search"]')

    expect(searchIcon?.classList.contains("z-10")).toBe(true)
    expect(input?.classList.contains("backdrop-blur-[10px]")).toBe(true)
    expect(input?.classList.contains("appearance-none")).toBe(true)
    expect(
      input?.classList.contains(
        "[&::-webkit-search-cancel-button]:appearance-none",
      ),
    ).toBe(true)

    searchLanguages(html, "english")

    const clearButton = html.querySelector('button[aria-label="Clear search"]')
    expect(clearButton?.classList.contains("z-10")).toBe(true)
    expect(clearButton?.classList.contains("end-3")).toBe(true)
    expect(searchIcon?.classList.contains("start-5")).toBe(true)
    expect(input?.classList.contains("ps-[3.25rem]")).toBe(true)
    expect(input?.classList.contains("pe-12")).toBe(true)
    expect(input?.className).not.toMatch(
      /(?:^|\s)(?:-?pl-|pr-|ml-|mr-|left-|right-|text-left|text-right)/,
    )
    expect(searchIcon?.getAttribute("class")).not.toMatch(
      /(?:^|\s)(?:-?pl-|pr-|ml-|mr-|left-|right-|text-left|text-right)/,
    )
  })

  it("declares mixed-language labels and mirrors the navigation arrow in RTL", () => {
    const arabic = language(1, {
      englishLabel: "Arabic",
      nativeLabel: "العربية",
      publicSlug: "arabic-modern-standard",
      bcp47: "ar",
    })
    const html = renderBrowser({
      regions: [
        {
          name: "Africa",
          languages: [arabic],
          countries: [
            {
              id: "country-eg",
              coreId: "EG",
              name: "Egypt",
              flagPngSrc: null,
              speakerCount: arabic.speakerCount,
              languageSpeakerCounts: languageSpeakerCounts([arabic]),
              languages: [arabic],
            },
          ],
        },
      ],
    })
    const englishLabel = Array.from(
      html.querySelectorAll("bdi[lang='en']"),
    ).find((element) => element.textContent === "Arabic")
    const nativeLabel = Array.from(
      html.querySelectorAll("bdi[lang='ar']"),
    ).find((element) => element.textContent === "العربية")
    const arrow = html.querySelector("svg.lucide-arrow-right")

    expect(englishLabel?.getAttribute("dir")).toBe("ltr")
    expect(nativeLabel?.getAttribute("dir")).toBe("rtl")
    expect(arrow?.classList.contains("rtl:rotate-180")).toBe(true)
  })

  it("uses English markup when the native label falls back to English", () => {
    const arabic = language(1, {
      englishLabel: "Arabic",
      nativeLabel: "Arabic",
      publicSlug: "arabic-modern-standard",
      bcp47: "ar",
    })
    const html = renderBrowser({
      regions: [
        {
          name: "Africa",
          languages: [arabic],
          countries: [
            {
              id: "country-eg",
              coreId: "EG",
              name: "Egypt",
              flagPngSrc: null,
              speakerCount: arabic.speakerCount,
              languageSpeakerCounts: languageSpeakerCounts([arabic]),
              languages: [arabic],
            },
          ],
        },
      ],
    })
    const labels = Array.from(html.querySelectorAll("bdi"))

    const englishLabels = labels.filter(
      (label) => label.textContent === "Arabic",
    )
    expect(englishLabels).toHaveLength(2)
    expect(englishLabels.map((label) => label.getAttribute("lang"))).toEqual([
      "en",
      "en",
    ])
    expect(englishLabels.map((label) => label.getAttribute("dir"))).toEqual([
      "ltr",
      "ltr",
    ])
  })

  it("uses the undetermined language fallback for unsupported metadata tags", () => {
    const languageWithInvalidTag = language(1, {
      englishLabel: "Language",
      nativeLabel: "Nom inconnu",
      publicSlug: "language-1",
      bcp47: "nan-CN-46",
    })
    const html = renderBrowser({
      regions: [
        {
          name: "Asia",
          languages: [languageWithInvalidTag],
          countries: [
            {
              id: "country-cn",
              coreId: "CN",
              name: "China",
              flagPngSrc: null,
              speakerCount: languageWithInvalidTag.speakerCount,
              languageSpeakerCounts: languageSpeakerCounts([
                languageWithInvalidTag,
              ]),
              languages: [languageWithInvalidTag],
            },
          ],
        },
      ],
    })
    const nativeLabel = Array.from(
      html.querySelectorAll("bdi[lang='und']"),
    ).find((element) => element.textContent === "Nom inconnu")

    expect(nativeLabel?.getAttribute("dir")).toBe("auto")
  })

  it("uses the shared Watch content rail", () => {
    const html = renderBrowser({ regions: [] })
    const section = html
      .querySelector("#language-index-title")
      ?.closest("section")

    for (const className of WATCH_PAGE_CONTENT_CLASSES.split(" ")) {
      expect(section?.className).toContain(className)
    }
  })

  it("collapses country languages after the top four", () => {
    const languages = [1, 2, 3, 4, 5].map((index) => language(index))
    const html = renderToString(
      <WatchLanguageIndexBrowser
        regions={[
          {
            name: "Africa",
            languages,
            countries: [
              {
                id: "country-gh",
                coreId: "GH",
                name: "Ghana",
                flagPngSrc: null,
                speakerCount: 50_000,
                languageSpeakerCounts: languageSpeakerCounts(languages),
                languages,
              },
            ],
          },
        ]}
      />,
    )

    expect(html).toContain("Language 1")
    expect(html).toContain("Language 2")
    expect(html).toContain("Language 3")
    expect(html).toContain("Language 4")
    expect(html).not.toContain("Language 5")
    expect(html).toContain("Show 1 more")
  })

  it("searches country names and keeps that country's languages visible", () => {
    const languages = [
      language(1, {
        englishLabel: "Romanian",
        nativeLabel: "romana",
        publicSlug: "romanian",
      }),
      language(2, {
        englishLabel: "Russian",
        nativeLabel: "russkiy",
        publicSlug: "russian",
      }),
      language(3, {
        englishLabel: "Akan",
        nativeLabel: "Akan",
        publicSlug: "akan",
      }),
    ]
    const html = renderBrowser({
      regions: [
        {
          name: "Europe",
          languages: languages.slice(0, 2),
          countries: [
            {
              id: "country-md",
              coreId: "MD",
              name: "Moldova",
              flagPngSrc: null,
              speakerCount: 20_000,
              languageSpeakerCounts: languageSpeakerCounts(
                languages.slice(0, 2),
              ),
              languages: languages.slice(0, 2),
            },
          ],
        },
        {
          name: "Africa",
          languages: [languages[2]],
          countries: [
            {
              id: "country-gh",
              coreId: "GH",
              name: "Ghana",
              flagPngSrc: null,
              speakerCount: 10_000,
              languageSpeakerCounts: languageSpeakerCounts([languages[2]]),
              languages: [languages[2]],
            },
          ],
        },
      ],
    })
    searchLanguages(html, "moldova")

    expect(html.textContent).toContain("Moldova")
    expect(html.textContent).toContain("Romanian")
    expect(html.textContent).toContain("Russian")
    expect(html.textContent).not.toContain("Ghana")
    expect(html.textContent).not.toContain("Akan")
  })

  it("puts country-name matches before language-only matches", () => {
    const romanian = language(1, {
      englishLabel: "Romanian",
      nativeLabel: "romana",
      publicSlug: "romanian",
      speakerCount: 17_800_000,
    })
    const russian = language(2, {
      englishLabel: "Russian",
      nativeLabel: "russkiy",
      publicSlug: "russian",
      speakerCount: 8_330_000,
    })
    const romani = language(3, {
      englishLabel: "Romani, Caldarasi",
      nativeLabel: "Romani",
      publicSlug: "romani-caldarasi",
      speakerCount: 513_000,
    })
    const html = renderBrowser({
      regions: [
        {
          name: "Africa",
          languages: [romani],
          countries: [
            {
              id: "country-gh",
              coreId: "GH",
              name: "Ghana",
              flagPngSrc: null,
              speakerCount: 513_000,
              languageSpeakerCounts: { [romani.publicSlug]: 513_000 },
              languages: [romani],
            },
          ],
        },
        {
          name: "Europe",
          languages: [romanian, russian, romani],
          countries: [
            {
              id: "country-ro",
              coreId: "RO",
              name: "Romania",
              flagPngSrc: null,
              speakerCount: 18_313_000,
              languageSpeakerCounts: {
                [romanian.publicSlug]: 17_800_000,
                [russian.publicSlug]: 0,
                [romani.publicSlug]: 513_000,
              },
              languages: [romanian, russian, romani],
            },
          ],
        },
      ],
    })

    searchLanguages(html, "roma")

    const [firstCountry] = countrySections(html)
    expect(firstCountry?.querySelector("h4")?.textContent).toBe("Romania")
    expect(firstCountry?.querySelector("a")?.textContent).toContain("Romanian")
  })

  it("sorts language-only country matches by country-specific speaker count", () => {
    const russian = language(1, {
      englishLabel: "Russian",
      nativeLabel: "russkiy",
      publicSlug: "russian",
      speakerCount: 145_500_000,
    })
    const tatar = language(2, {
      englishLabel: "Tatar",
      nativeLabel: "Tatar",
      publicSlug: "tatar",
      speakerCount: 4_280_000,
    })
    const html = renderBrowser({
      regions: [
        {
          name: "North America",
          languages: [russian],
          countries: [
            {
              id: "country-ca",
              coreId: "CA",
              name: "Canada",
              flagPngSrc: null,
              speakerCount: 170_000,
              languageSpeakerCounts: { [russian.publicSlug]: 170_000 },
              languages: [russian],
            },
          ],
        },
        {
          name: "Europe",
          languages: [russian, tatar],
          countries: [
            {
              id: "country-ua",
              coreId: "UA",
              name: "Ukraine",
              flagPngSrc: null,
              speakerCount: 8_330_000,
              languageSpeakerCounts: { [russian.publicSlug]: 8_330_000 },
              languages: [russian],
            },
            {
              id: "country-ru",
              coreId: "RU",
              name: "Russia",
              flagPngSrc: null,
              speakerCount: 141_280_000,
              languageSpeakerCounts: {
                [russian.publicSlug]: 137_000_000,
                [tatar.publicSlug]: 4_280_000,
              },
              languages: [russian, tatar],
            },
          ],
        },
      ],
    })

    searchLanguages(html, "russ")

    expect(
      countrySections(html).map(
        (section) => section.querySelector("h4")?.textContent,
      ),
    ).toEqual(["Russia", "Ukraine", "Canada"])
  })

  it("finds a reviewed alias and preserves speaker-count ordering", () => {
    const cantonese = language(1, {
      englishLabel: "Cantonese",
      nativeLabel: "廣東話",
      publicSlug: "cantonese",
      speakerCount: 85_600_000,
    })
    const html = renderBrowser({
      regions: [
        {
          name: "Asia",
          languages: [cantonese],
          countries: [
            {
              id: "country-hk",
              coreId: "HK",
              name: "Hong Kong",
              flagPngSrc: null,
              speakerCount: 6_500_000,
              languageSpeakerCounts: {
                [cantonese.publicSlug]: 6_500_000,
              },
              languages: [cantonese],
            },
            {
              id: "country-cn",
              coreId: "CN",
              name: "China",
              flagPngSrc: null,
              speakerCount: 79_000_000,
              languageSpeakerCounts: {
                [cantonese.publicSlug]: 79_000_000,
              },
              languages: [cantonese],
            },
          ],
        },
      ],
    })

    searchLanguages(html, "粤语")

    expect(html.textContent).toContain("Cantonese")
    expect(html.textContent).toContain("廣東話")
    expect(
      countrySections(html).map(
        (section) => section.querySelector("h4")?.textContent,
      ),
    ).toEqual(["China", "Hong Kong"])
  })
})
