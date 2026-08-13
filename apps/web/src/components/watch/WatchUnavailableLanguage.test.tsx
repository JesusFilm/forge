/**
 * @vitest-environment jsdom
 */
import { createElement, StrictMode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SearchResult } from "@/lib/search"
import { writeWatchUnavailableRecoveryContext } from "@/lib/watch-unavailable-recovery-context"

vi.unmock("next-intl")

const { pushMock, resolveRecoveryMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  resolveRecoveryMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/good-friday-live.html/chinese-simplified.html",
  useRouter: () => ({ push: pushMock }),
}))

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement("img", { alt, src }),
}))

vi.mock("@/lib/watch-unavailable-recovery-actions", () => ({
  resolveWatchUnavailableRecovery: resolveRecoveryMock,
}))

import {
  WatchUnavailableLanguageClient,
  parseUnavailableWatchPath,
} from "./WatchUnavailableLanguageClient"

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
  resolveRecoveryMock.mockReset()
  vi.useRealTimers()
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

describe("WatchUnavailableLanguageClient", () => {
  it("waits for approved artwork instead of downloading the fallback first", async () => {
    writeWatchUnavailableRecoveryContext({
      target: searchResult(),
      requestedLanguageSlug: "chinese-simplified",
      requestedLanguageName: "简体中文",
    })
    let resolveRecovery: (
      value: Awaited<ReturnType<typeof resolveRecoveryMock>>,
    ) => void = () => {}
    resolveRecoveryMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRecovery = resolve
      }),
    )

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <NextIntlClientProvider
          locale="zh-Hans"
          messages={{
            WatchUnavailableLanguage: messages,
            LanguageCombobox: languageComboboxMessages,
          }}
        >
          <WatchUnavailableLanguageClient />
        </NextIntlClientProvider>,
      )
    })

    const artwork = container.querySelector(
      '[data-testid="watch-unavailable-artwork"]',
    )
    expect(artwork?.getAttribute("data-state")).toBe("pending")
    expect(artwork?.className).toContain("bg-[linear-gradient")
    expect(container.querySelector("img")).toBeNull()

    await act(async () => {
      resolveRecovery({
        verifiedGap: true,
        targetImageUrl:
          "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
        audioOptions: [],
      })
    })

    expect(artwork?.getAttribute("data-state")).toBe("resolved")
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
    )
  })

  it("requires an explicit same-video audio selection before navigation", async () => {
    writeWatchUnavailableRecoveryContext({
      target: searchResult(),
      requestedLanguageSlug: "chinese-simplified",
      requestedLanguageName: "简体中文",
    })
    resolveRecoveryMock.mockResolvedValue({
      verifiedGap: true,
      targetImageUrl:
        "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
      audioOptions: [
        {
          slug: "english",
          name: "English",
          nativeName: null,
          bcp47: "en",
          href: "/good-friday-live.html",
        },
        {
          slug: "spanish-castilian",
          name: "Spanish Castilian",
          nativeName: "Español",
          bcp47: "es",
          href: "/good-friday-live.html/spanish-castilian.html",
        },
      ],
    })

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
            <WatchUnavailableLanguageClient />
          </NextIntlClientProvider>
        </StrictMode>,
      )
    })

    const heading = container.querySelector("h1")
    expect(heading?.textContent).toContain("耶稣受难日直播暂无简体中文版本")
    expect(
      [...(heading?.querySelectorAll("bdi[dir=auto]") ?? [])].map(
        (node) => node.textContent,
      ),
    ).toEqual(["耶稣受难日直播", "简体中文"])
    expect(heading?.className).toContain("2xl:max-w-5xl")
    expect(
      [...(heading?.querySelectorAll("bdi[dir=auto]") ?? [])].every(
        (node) =>
          node.classList.contains("inline-block") &&
          node.classList.contains("max-w-full"),
      ),
    ).toBe(true)
    expect(container.textContent).not.toContain("Watch in English")
    expect(container.textContent).not.toContain("Choose another language")
    expect(container.textContent).toContain("Back to search")
    expect(container.textContent).toContain("Other audio versions")
    expect(container.textContent).not.toContain("More videos available")
    const audioPanel = container.querySelector(
      '[data-testid="watch-unavailable-audio-panel"]',
    )
    expect(audioPanel?.className).toContain("rounded-2xl")
    expect(audioPanel?.className).toContain("bg-black/45")
    expect(audioPanel?.className).not.toContain("border-t")
    expect(container.textContent).not.toContain("404")
    const watchButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="watch-selected-language"]',
    )
    expect(watchButton?.disabled).toBe(true)

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="language-combobox-trigger"]',
    )
    expect(trigger?.textContent).toContain("Select a language version")
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
    expect(resolveRecoveryMock).toHaveBeenCalledTimes(1)
    expect(
      [...container.querySelectorAll("a")].every(
        (link) => !link.hasAttribute("data-prefetch"),
      ),
    ).toBe(true)
  })

  it("hides the selector when the same video has no admitted audio version", async () => {
    resolveRecoveryMock.mockResolvedValue({
      verifiedGap: true,
      targetImageUrl: null,
      audioOptions: [],
    })

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <NextIntlClientProvider
          locale="zh-Hans"
          messages={{
            WatchUnavailableLanguage: messages,
            LanguageCombobox: languageComboboxMessages,
          }}
        >
          <WatchUnavailableLanguageClient />
        </NextIntlClientProvider>,
      )
    })

    expect(
      container.querySelector('[data-testid="language-combobox-trigger"]'),
    ).toBeNull()
    expect(container.querySelector("h1")?.textContent).toContain(
      "Good Friday Live暂无简体中文版本",
    )
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/watch/images/thumbnails/11_Advent0304-vertical.jpg",
    )
    expect(container.textContent).toContain("Browse videos in")
  })

  it("falls back to safe browse-only actions when recovery resolution fails", async () => {
    vi.useFakeTimers()
    resolveRecoveryMock.mockRejectedValue(new Error("manifest unavailable"))

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <NextIntlClientProvider
          locale="zh-Hans"
          messages={{
            WatchUnavailableLanguage: messages,
            LanguageCombobox: languageComboboxMessages,
          }}
        >
          <WatchUnavailableLanguageClient />
        </NextIntlClientProvider>,
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(
      container.querySelector('[data-testid="language-combobox-trigger"]'),
    ).toBeNull()
    expect(container.textContent).toContain("Browse videos in")
    expect(container.textContent).not.toContain("Watch selected version")
    expect(resolveRecoveryMock).toHaveBeenCalledTimes(2)
  })

  it("recovers from one transient resolution failure", async () => {
    vi.useFakeTimers()
    resolveRecoveryMock
      .mockRejectedValueOnce(new Error("temporary manifest failure"))
      .mockResolvedValue({
        verifiedGap: true,
        targetImageUrl: null,
        audioOptions: [
          {
            slug: "english",
            name: "English",
            nativeName: null,
            bcp47: "en",
            href: "/good-friday-live.html",
          },
        ],
      })

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <NextIntlClientProvider
          locale="zh-Hans"
          messages={{
            WatchUnavailableLanguage: messages,
            LanguageCombobox: languageComboboxMessages,
          }}
        >
          <WatchUnavailableLanguageClient />
        </NextIntlClientProvider>,
      )
    })
    expect(resolveRecoveryMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    expect(resolveRecoveryMock).toHaveBeenCalledTimes(2)
    expect(
      container.querySelector('[data-testid="language-combobox-trigger"]'),
    ).not.toBeNull()
  })
})
