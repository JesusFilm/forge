/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import LanguageVideosLoading from "@/app/[locale]/[htmlLang]/videos/[languageSlug]/loading"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "loadingContent" ? "Loading content" : key,
}))

describe("language videos loading boundary", () => {
  it("renders accessible progress feedback while the route resolves", () => {
    const html = renderToString(<LanguageVideosLoading />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('aria-label="Loading content"')
    expect(html).toContain("Loading content")
  })
})
