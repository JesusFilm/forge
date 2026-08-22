import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { languagesIndexPath, searchPath } from "@/lib/routes"
import { LanguageGlobeSection } from "./LanguageGlobeSection"

describe("LanguageGlobeSection", () => {
  it("composes configurable copy and actions above one embedded globe", () => {
    const markup = renderToStaticMarkup(
      <LanguageGlobeSection
        actions={[
          {
            href: languagesIndexPath(),
            label: "Select your language",
          },
          {
            href: searchPath(),
            label: "Back to Watch",
            variant: "secondary",
          },
        ]}
        actionsLabel="Language actions"
        description="Films and videos in languages from around the world."
        eyebrow="Every nation"
        headingId="language-heading"
        title="Choose a language"
      >
        <p>Additional authored-style content.</p>
      </LanguageGlobeSection>,
    )

    expect(markup).toContain('aria-labelledby="language-heading"')
    expect(markup).toContain("<h2")
    expect(markup).toContain("Choose a language")
    expect(markup).toContain("Additional authored-style content.")
    expect(markup).toContain('href="/languages"')
    expect(markup).toContain('href="/"')
    expect(markup.match(/data-testid="language-globe-surface"/g)).toHaveLength(
      1,
    )
    expect(markup.match(/data-testid="language-globe-canvas"/g)).toHaveLength(1)
  })

  it("supports a not-found h1 and decorative watermark", () => {
    const markup = renderToStaticMarkup(
      <LanguageGlobeSection
        headingId="not-found-heading"
        headingLevel="h1"
        title="This page is not here"
        variant="not-found"
        watermark="404"
      />,
    )

    expect(markup).toContain("<h1")
    expect(markup).toContain("This page is not here")
    expect(markup).toContain('data-language-globe-section="not-found"')
    expect(markup).toContain('data-testid="language-globe-watermark"')
  })
})
