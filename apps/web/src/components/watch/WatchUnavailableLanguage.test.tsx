/**
 * @vitest-environment jsdom
 */
import { createElement, StrictMode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "@/lib/routes"
import type { SearchResult } from "@/lib/search"
import type { WatchUnavailableRecoveryResolution } from "@/lib/watch-unavailable-recovery-actions"
import { writeWatchUnavailableRecoveryContext } from "@/lib/watch-unavailable-recovery-context"
import { parseUnavailableWatchPath } from "@/lib/watch-unavailable-recovery"

vi.unmock("next-intl")

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement("img", { alt, src }),
}))

import { WatchUnavailableLanguageClient } from "./WatchUnavailableLanguageClient"

const messages = {
  metadataTitle: "Language version unavailable",
  eyebrow: "Language version unavailable",
  title:
    "<contentTitle>{title}</contentTitle>暂无<languageName>{language}</languageName>版本",
  actionsLabel: "Available viewing options",
  browseInLanguage: "Browse videos in {language}",
  backToSearch: "Back to search",
  audioVersionsTitle: "Other audio versions",
  audioVersionsDescription:
    "Choose an audio language to continue watching this video.",
  languageVersionLabel: "Audio language",
  selectLanguageVersion: "Select a language version",
  watchSelectedVersion: "Watch selected version",
}

const languageComboboxMessages = {
  selectLanguage: "Select language",
  searchPlaceholder: "Search languages…",
  languages: "Languages",
  noMatches: "No matches",
  notAvailable: "Not available",
}

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "video",
    id: "target",
    slug: "good-friday-live",
    title: "耶稣受难日直播",
    imageUrl:
      "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    snippet: "",
    startSeconds: null,
    playbackId: null,
    score: 1,
    label: "SHORT_FILM",
    durationSeconds: null,
    childCount: 0,
    availabilityKind: "unavailable",
    languageSlug: null,
    ...overrides,
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  sessionStorage.clear()
  pushMock.mockReset()
})

describe("parseUnavailableWatchPath", () => {
  it("parses explicit and canonical English unavailable paths", () => {
    expect(
      parseUnavailableWatchPath(
        "/good-friday-live.html/chinese-simplified.html",
      ),
    ).toEqual({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "chinese-simplified",
    })
    expect(parseUnavailableWatchPath("/good-friday-live.html")).toEqual({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "english",
    })
  })

  it("rejects malformed and unsupported paths", () => {
    expect(parseUnavailableWatchPath("/unknown")).toBeNull()
    expect(parseUnavailableWatchPath("/video.html/not-a-language.html")).toBe(
      null,
    )
  })
})

const parsedPath = {
  contentSlug: "good-friday-live",
  requestedLanguageSlug: "chinese-simplified",
}

const goodFridayLiveSlug = tryAsContentSlug("good-friday-live")
const englishSlug = tryAsLocaleSlug("english")
const spanishCastilianSlug = tryAsLocaleSlug("spanish-castilian")
if (
  goodFridayLiveSlug == null ||
  englishSlug == null ||
  spanishCastilianSlug == null
) {
  throw new Error("Expected the recovery fixture slugs to be valid")
}

const resolvedRecovery: WatchUnavailableRecoveryResolution = {
  verifiedGap: true,
  contentTitle: "耶稣受难日直播",
  targetImageUrl:
    "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
  audioOptions: [
    {
      slug: "english",
      name: "English",
      nativeName: null,
      bcp47: "en",
      href: watchVideoPath(goodFridayLiveSlug, englishSlug),
    },
    {
      slug: "spanish-castilian",
      name: "Spanish Castilian",
      nativeName: "Español",
      bcp47: "es",
      href: watchVideoPath(goodFridayLiveSlug, spanishCastilianSlug),
    },
  ],
}

async function renderClient(
  initialResolution: WatchUnavailableRecoveryResolution,
) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <StrictMode>
        <NextIntlClientProvider
          locale="zh-Hans"
          messages={{
            WatchUnavailableLanguage: messages,
            LanguageCombobox: languageComboboxMessages,
          }}
        >
          <WatchUnavailableLanguageClient
            parsed={parsedPath}
            initialResolution={initialResolution}
          />
        </NextIntlClientProvider>
      </StrictMode>,
    )
  })
}

describe("WatchUnavailableLanguageClient", () => {
  it("renders final title, artwork, and audio choices on its first render", async () => {
    await renderClient(resolvedRecovery)
    const artwork = container?.querySelector(
      '[data-testid="watch-unavailable-artwork"]',
    )
    expect(artwork?.getAttribute("data-state")).toBe("resolved")
    expect(container?.querySelector("img")?.getAttribute("src")).toBe(
      resolvedRecovery.targetImageUrl,
    )
    expect(container?.querySelector("h1")?.textContent).toContain(
      "耶稣受难日直播暂无简体中文版本",
    )
    expect(
      container?.querySelector('[data-testid="watch-unavailable-audio-panel"]'),
    ).not.toBeNull()
  })

  it("requires an explicit same-video audio selection before navigation", async () => {
    await renderClient(resolvedRecovery)

    const heading = container?.querySelector("h1")
    expect(
      [...(heading?.querySelectorAll("bdi[dir=auto]") ?? [])].map(
        (node) => node.textContent,
      ),
    ).toEqual(["耶稣受难日直播", "简体中文"])
    expect(heading?.className).toContain("2xl:max-w-5xl")
    expect(container?.textContent).toContain("Back to search")
    expect(container?.textContent).not.toContain("404")
    const watchButton = container?.querySelector<HTMLButtonElement>(
      '[data-testid="watch-selected-language"]',
    )
    expect(watchButton?.disabled).toBe(true)

    const trigger = container?.querySelector<HTMLButtonElement>(
      '[data-testid="language-combobox-trigger"]',
    )
    await act(async () => trigger?.click())
    const spanishOption = document.body.querySelector<HTMLButtonElement>(
      '[data-language-slug="spanish-castilian"]',
    )
    await act(async () => spanishOption?.click())
    expect(watchButton?.disabled).toBe(false)
    await act(async () => watchButton?.click())
    expect(pushMock).toHaveBeenCalledWith(
      "/good-friday-live.html/spanish-castilian.html",
    )
  })

  it("renders one stable fallback when recovery data is unavailable", async () => {
    await renderClient({
      verifiedGap: false,
      contentTitle: null,
      targetImageUrl: null,
      audioOptions: [],
    })

    expect(
      container?.querySelector('[data-testid="language-combobox-trigger"]'),
    ).toBeNull()
    expect(container?.querySelector("h1")?.textContent).toContain(
      "Good Friday Live暂无简体中文版本",
    )
    expect(container?.querySelector("img")?.getAttribute("src")).toBe(
      "/watch/images/thumbnails/11_Advent0304-vertical.jpg",
    )
    expect(
      container
        ?.querySelector('[data-testid="watch-unavailable-artwork"]')
        ?.getAttribute("data-state"),
    ).toBe("fallback")
  })

  it("keeps playable choices when only recovery copy and artwork are unavailable", async () => {
    await renderClient({
      ...resolvedRecovery,
      contentTitle: null,
      targetImageUrl: null,
    })

    expect(container?.querySelector("h1")?.textContent).toContain(
      "Good Friday Live暂无简体中文版本",
    )
    expect(
      container?.querySelector('[data-testid="watch-unavailable-audio-panel"]'),
    ).not.toBeNull()
    expect(
      container
        ?.querySelector('[data-testid="watch-unavailable-artwork"]')
        ?.getAttribute("data-state"),
    ).toBe("fallback")
  })

  it("returns to browser search context or falls back to Watch home", async () => {
    const historyBack = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => {})
    writeWatchUnavailableRecoveryContext({
      target: searchResult(),
      requestedLanguageSlug: "chinese-simplified",
      requestedLanguageName: "简体中文",
    })
    await renderClient(resolvedRecovery)

    const backButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Back to search"),
    )
    await act(async () => backButton?.click())
    expect(historyBack).toHaveBeenCalledTimes(1)

    sessionStorage.clear()
    await act(async () => backButton?.click())
    expect(pushMock).toHaveBeenCalledWith("/")
    historyBack.mockRestore()
  })
})
