import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const messages: Record<string, string> = {
      "LanguageCombobox.selectLanguage": "Select language",
      "WatchLanguageIndex.description":
        "Explore languages by region or browse the full list.",
      "WatchLanguageIndex.eyebrow": "Watch languages",
      "WatchLanguageIndex.title": "Choose a language",
    }
    return messages[`${namespace}.${key}`] ?? key
  },
}))

import { WatchLanguageGlobeSection } from "./WatchLanguageGlobeSection"

describe("WatchLanguageGlobeSection", () => {
  it("renders localized language copy and the canonical inventory action", () => {
    const markup = renderToStaticMarkup(<WatchLanguageGlobeSection />)

    expect(markup).toContain("Watch languages")
    expect(markup).toContain("Choose a language")
    expect(markup).toContain(
      "Explore languages by region or browse the full list.",
    )
    expect(markup).toContain("Select language")
    expect(markup).toContain('href="/languages"')
    expect(markup).toContain('data-section-key="watch-language-globe"')
    expect(markup).toContain('data-testid="deferred-language-globe"')
    expect(markup).not.toContain('data-testid="language-globe-canvas"')
  })
})
