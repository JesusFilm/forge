/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  WatchHomeFirstScreen,
  watchHomeLanguageName,
} from "./WatchHomeFirstScreen"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

describe("watchHomeLanguageName", () => {
  it("names the root English home in its chrome language", () => {
    expect(watchHomeLanguageName("english", "en")).toBe("English")
  })

  it("names the content language when the chrome falls back to English", () => {
    // `arabic-najdi` ships no UI catalog, so its chrome renders English while
    // its videos are Najdi Arabic. The heading must follow the videos.
    expect(watchHomeLanguageName("arabic-najdi", "en")).toBe("Najdi Arabic")
  })

  it("localizes the content language name into a translated chrome", () => {
    expect(watchHomeLanguageName("spanish-latin-american", "es")).toBe(
      "español latinoamericano",
    )
  })

  it("falls back to the title-cased slug for a tag that is not BCP-47", () => {
    // The generated map carries `hainanese` → `nan-CN-46`, which
    // `Intl.Locale` rejects; announcing the English chrome would be wrong.
    expect(watchHomeLanguageName("hainanese", "en")).toBe("Hainanese")
  })

  it("never announces the chrome language for an unmapped slug", () => {
    expect(watchHomeLanguageName("newly-published-language", "es")).toBe(
      "Newly Published Language",
    )
  })
})

describe("WatchHomeFirstScreen", () => {
  it("lets clicks through to the hero controls except on its own link", () => {
    // jsdom cannot hit-test, so this pins the classes that decide it. The
    // first screen overlays Watch Now, mute, and the slide thumbnails; a
    // pointer-events-auto box here made all of them unclickable at 1280x800
    // (Chromium elementFromPoint check, 2026-10-09).
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(
      <WatchHomeFirstScreen locale="en" languageSlug="english" />,
    )
    const root = container.querySelector(
      '[data-testid="watch-home-first-screen"]',
    )
    const link = container.querySelector(
      '[data-testid="watch-home-find-language"]',
    )

    expect(root?.classList.contains("pointer-events-none")).toBe(true)
    expect(container.querySelector(".pointer-events-auto")).toBe(link)
  })
})
