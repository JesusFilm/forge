import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LanguageGlobeExperience } from "./LanguageGlobeExperience"

describe("LanguageGlobeExperience", () => {
  it("renders the authored copy, CTA, and deferred globe", () => {
    const markup = renderToStaticMarkup(
      <LanguageGlobeExperience
        data={{
          sectionKey: "world-languages",
          eyebrow: "Every nation",
          title: "Choose your language",
          description: "Watch in the language you understand best.",
          ctaEnabled: true,
          ctaLabel: "Browse languages",
          ctaLink: "/languages",
        }}
      />,
    )

    expect(markup).toContain("Every nation")
    expect(markup).toContain("Choose your language")
    expect(markup).toContain("Watch in the language you understand best.")
    expect(markup).toContain("Browse languages")
    expect(markup).toContain('href="/languages"')
    expect(markup).toContain('data-section-key="world-languages"')
    expect(markup).toContain('id="world-languages-heading"')
    expect(markup).toContain('data-testid="deferred-language-globe"')
  })

  it("omits the CTA when editors disable it", () => {
    const markup = renderToStaticMarkup(
      <LanguageGlobeExperience
        data={{
          title: "Choose your language",
          ctaEnabled: false,
          ctaLabel: "Browse languages",
          ctaLink: "/languages",
        }}
      />,
    )

    expect(markup).not.toContain("Browse languages")
    expect(markup).not.toContain('href="/languages"')
  })

  it("does not render an invalid blank authored title", () => {
    expect(
      renderToStaticMarkup(<LanguageGlobeExperience data={{ title: "   " }} />),
    ).toBe("")
  })
})
