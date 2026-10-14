import { readFileSync } from "node:fs"
import { join } from "node:path"

import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { WatchRouteLoadingShell } from "@/components/WatchRouteLoadingShell"

describe("WatchRouteLoadingShell", () => {
  it("renders one localized status landmark inside a decorative header", () => {
    const html = renderToString(
      <NextIntlClientProvider
        locale="en"
        messages={{ ExperienceSkeleton: { loadingContent: "Loading content" } }}
      >
        <WatchRouteLoadingShell />
      </NextIntlClientProvider>,
    )

    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Loading content"')
    // The header placeholder is decorative; the real chrome replaces it.
    expect(html).toContain('aria-hidden="true"')
    // A loading fallback must not own a document landmark.
    expect(html).not.toContain("<main")
  })

  it("does not import the language corpus or mount chrome providers", () => {
    // Pins the bundle-size contract: the fallback ships to the client, so it
    // must stay free of `@/lib/locale` (full BCP-47 map) and chrome providers.
    const source = readFileSync(
      join(__dirname, "WatchRouteLoadingShell.tsx"),
      "utf8",
    )
    const imports = source.match(/^import .*$/gm) ?? []

    expect(imports.join("\n")).not.toMatch(
      /WatchChromeShell|@\/lib\/locale|FloatingSearchProvider/,
    )
  })
})
