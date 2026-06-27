/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { WatchLanguageIndexBrowser } from "./WatchLanguageIndexBrowser"

function language(index: number) {
  return {
    id: `lang-${index}`,
    coreId: `${index}`,
    englishLabel: `Language ${index}`,
    nativeLabel: `Native ${index}`,
    publicSlug: `language-${index}`,
    href: `/language-${index}.html/videos`,
    bcp47: `l${index}`,
    speakerCount: 10_000 - index,
    regionNames: ["Africa"],
    flagPngSrc: null,
  }
}

describe("WatchLanguageIndexBrowser", () => {
  it("collapses country languages after the top four", () => {
    const languages = [1, 2, 3, 4, 5].map(language)
    const html = renderToString(
      <WatchLanguageIndexBrowser
        languages={languages}
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
})
