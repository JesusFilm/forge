/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { AbstractIntlMessages } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"
import enMessages from "../../../messages/en.json"

import type { WatchSubtitle } from "@/lib/content"

const { getLanguagePickerCatalogState, resetLanguagePickerMessages } =
  vi.hoisted(() => {
    let activeCatalog: AbstractIntlMessages = { LanguagePickerModal: {} }

    return {
      resetLanguagePickerMessages: (catalog: AbstractIntlMessages) => {
        activeCatalog = structuredClone(catalog)
      },
      getLanguagePickerCatalogState: () => activeCatalog,
    }
  })

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({
        locale: "en",
        messages: getLanguagePickerCatalogState(),
        namespace,
      }),
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}))

vi.mock("@/lib/language-preference-client", () => ({
  writePreferredLanguageSlug: vi.fn(),
}))

import {
  LanguagePickerModal,
  type LanguagePickerVariant,
} from "@/components/watch/LanguagePickerModal"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resetLanguagePickerMessages(enMessages)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

function makeVariant(
  overrides: Partial<LanguagePickerVariant> & {
    documentId: string
    languageSlug: string
  },
): LanguagePickerVariant {
  const { languageSlug, documentId, ...rest } = overrides
  const base: LanguagePickerVariant = {
    documentId,
    hls: "https://stream.mux.com/x.m3u8",
    published: true,
    language: {
      coreId: languageSlug,
      slug: languageSlug,
      name: languageSlug.replace(/^./, (letter) => letter.toUpperCase()),
    },
  }
  return { ...base, ...rest }
}

function makeSubtitle(
  documentId: string,
  languageSlug: string,
  name: string,
): WatchSubtitle {
  return {
    documentId,
    language: {
      slug: languageSlug,
      name,
      nativeName: null,
      bcp47: languageSlug,
    },
    vttSrc: `https://cdn.test/${languageSlug}.vtt`,
    primary: false,
    aiGenerated: false,
  }
}

function renderModal({
  currentLanguageSlug = "english",
  variants,
  subtitles,
  currentSubtitleEnabled,
  currentSubtitleSlug,
}: {
  currentLanguageSlug?: string
  variants: LanguagePickerVariant[]
  subtitles?: WatchSubtitle[]
  currentSubtitleEnabled?: boolean
  currentSubtitleSlug?: string | null
}) {
  act(() => {
    root.render(
      <LanguagePickerModal
        open
        variants={variants}
        currentLanguageSlug={currentLanguageSlug}
        videoSlug="the-call"
        playerRef={{ current: { currentTime: 42 } as MuxPlayerRef }}
        onClose={vi.fn()}
        subtitles={subtitles}
        currentSubtitleEnabled={currentSubtitleEnabled}
        currentSubtitleSlug={currentSubtitleSlug}
      />,
    )
  })
}

describe("LanguagePickerModal Chinese aliases", () => {
  it("finds only playable audio options through Chinese aliases", () => {
    renderModal({
      variants: [
        makeVariant({ documentId: "v1", languageSlug: "english" }),
        makeVariant({
          documentId: "v2",
          languageSlug: "mandarin-china",
        }),
        makeVariant({ documentId: "v3", languageSlug: "cantonese" }),
      ],
    })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "粤语"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(
      $$('[data-testid="language-combobox-option"]').map((option) =>
        option.getAttribute("data-language-slug"),
      ),
    ).toEqual(["cantonese"])

    act(() => {
      input.value = "臺語"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect($$('[data-testid="language-combobox-option"]')).toHaveLength(0)
  })

  it("does not expose an alias whose audio option is unavailable", () => {
    renderModal({
      variants: [
        makeVariant({ documentId: "v1", languageSlug: "english" }),
        makeVariant({
          documentId: "v2",
          languageSlug: "mandarin-china",
        }),
      ],
    })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "粤语"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect($$('[data-testid="language-combobox-option"]')).toHaveLength(0)
  })

  it("filters real subtitles by alias without exposing a disabled audio-language row", () => {
    renderModal({
      variants: [
        makeVariant({ documentId: "v1", languageSlug: "english" }),
        makeVariant({
          documentId: "v2",
          languageSlug: "mandarin-china",
        }),
      ],
      currentLanguageSlug: "mandarin-china",
      subtitles: [
        makeSubtitle(
          "sub-zh-hant",
          "chinese-traditional",
          "Chinese Traditional",
        ),
      ],
      currentSubtitleEnabled: true,
      currentSubtitleSlug: "chinese-traditional",
    })

    const triggers = $$('[data-testid="language-combobox-trigger"]')
    expect(triggers).toHaveLength(2)
    act(() => triggers[1]?.click())

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "繁體中文"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(
      $$('[data-testid="language-combobox-option"]').map((option) =>
        option.getAttribute("data-language-slug"),
      ),
    ).toEqual(["chinese-traditional"])

    act(() => {
      input.value = "普通话"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect($$('[data-testid="language-combobox-option"]')).toHaveLength(0)

    act(() => {
      input.value = "Mandarin"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const contextRow = $$('[data-testid="language-combobox-option"]')
    expect(contextRow).toHaveLength(1)
    expect(contextRow[0]?.getAttribute("data-language-slug")).toBe(
      "mandarin-china",
    )
    expect(contextRow[0]?.getAttribute("data-disabled")).toBe("true")
  })

  it("matches a playable audio option by alias without inventing a native name", () => {
    renderModal({
      variants: [
        makeVariant({ documentId: "v1", languageSlug: "english" }),
        makeVariant({
          documentId: "v2",
          languageSlug: "foochow",
          language: {
            coreId: "foochow",
            slug: "foochow",
            name: "Foochow",
            nativeName: null,
            bcp47: "cdo",
          },
        }),
      ],
    })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "福州话"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const result = $('[data-testid="language-combobox-option"]')
    expect(result?.getAttribute("data-language-slug")).toBe("foochow")
    expect(result?.textContent).not.toContain("福州話")
  })

  it("matches a real subtitle by alias without inventing a native name", () => {
    renderModal({
      variants: [makeVariant({ documentId: "v1", languageSlug: "english" })],
      subtitles: [makeSubtitle("sub-hui", "hui", "Hui")],
      currentSubtitleEnabled: true,
      currentSubtitleSlug: "hui",
    })

    const triggers = $$('[data-testid="language-combobox-trigger"]')
    expect(triggers).toHaveLength(2)
    act(() => triggers[1]?.click())

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "徽州话"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const result = $('[data-testid="language-combobox-option"]')
    expect(result?.getAttribute("data-language-slug")).toBe("hui")
    expect(result?.textContent).not.toContain("徽州話")
  })
})
