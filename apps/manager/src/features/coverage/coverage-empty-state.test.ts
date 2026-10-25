import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { LanguageSelectionEmptyState } from "@/features/coverage/coverage-empty-state"

describe("coverage-empty-state", () => {
  it("keeps a general language-browsing action alongside presets", () => {
    const markup = renderToStaticMarkup(
      React.createElement(LanguageSelectionEmptyState, {
        reportLabel: "Subtitles",
        presets: [
          { id: "lang-en", label: "English" },
          { id: "lang-fr", label: "French" },
        ],
        onSelectPreset: vi.fn(),
        onBrowseAllLanguages: vi.fn(),
      }),
    )

    expect(markup).toContain("Select a language to begin")
    expect(markup).toContain("Browse all languages")
    expect(markup).toContain("English")
    expect(markup).toContain("French")
  })
})
