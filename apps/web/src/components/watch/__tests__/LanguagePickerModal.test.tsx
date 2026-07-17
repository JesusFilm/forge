/**
 * @vitest-environment jsdom
 *
 * LanguagePickerModal tests — globe-driven overlay rewrite.
 *
 * Covers:
 *  - Apply disabled until selection differs from current
 *  - Apply navigates via watchVideoPath or contextual watchEpisodePath when
 *    collectionSlug is present.
 *  - Apply writes the language-preference cookie BEFORE router.push
 *  - Close does nothing besides onClose
 *  - Draft resets when the modal reopens
 *  - Selecting the current language and clicking Apply is a no-op nav
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { AbstractIntlMessages } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"
import arMessages from "../../../../messages/ar.json"
import enMessages from "../../../../messages/en.json"
import ruMessages from "../../../../messages/ru.json"

type LanguagePickerTestCatalog = AbstractIntlMessages & {
  LanguagePickerModal: Record<string, string>
}

const {
  resetLanguagePickerMessages,
  routerPrefetchMock,
  routerPushMock,
  setLanguagePickerCatalog,
  setLanguagePickerMessages,
  getLanguagePickerCatalogState,
  writePreferredLanguageSlugMock,
} = vi.hoisted(() => {
  let activeLocale = "en"
  let sourceCatalog: LanguagePickerTestCatalog = { LanguagePickerModal: {} }
  let activeCatalog: LanguagePickerTestCatalog = { LanguagePickerModal: {} }

  return {
    routerPrefetchMock: vi.fn(),
    routerPushMock: vi.fn(),
    writePreferredLanguageSlugMock: vi.fn(),
    resetLanguagePickerMessages: (catalog: LanguagePickerTestCatalog) => {
      activeLocale = "en"
      sourceCatalog = structuredClone(catalog)
      activeCatalog = structuredClone(catalog)
    },
    setLanguagePickerCatalog: (
      catalog: LanguagePickerTestCatalog,
      locale: string,
    ) => {
      activeLocale = locale
      activeCatalog = structuredClone(catalog)
    },
    setLanguagePickerMessages: (messages: Record<string, string>) => {
      activeLocale = "en"
      activeCatalog = {
        ...structuredClone(sourceCatalog),
        LanguagePickerModal: {
          ...sourceCatalog.LanguagePickerModal,
          ...messages,
        },
      }
    },
    getLanguagePickerCatalogState: () => ({
      locale: activeLocale,
      messages: activeCatalog,
    }),
  }
})

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      const { locale, messages } = getLanguagePickerCatalogState()
      return actual.createTranslator({
        locale,
        messages,
        namespace,
      })
    },
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: routerPrefetchMock,
    push: routerPushMock,
  }),
}))

vi.mock("@/lib/language-preference-client", () => ({
  LANGUAGE_PREFERENCE_COOKIE: "forge_watch_lang",
  writePreferredLanguageSlug: writePreferredLanguageSlugMock,
}))

import {
  LanguagePickerModal,
  type LanguagePickerVariant,
} from "@/components/watch/LanguagePickerModal"
import type { WatchSubtitle } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resetLanguagePickerMessages(enMessages)
  routerPrefetchMock.mockReset()
  routerPushMock.mockReset()
  writePreferredLanguageSlugMock.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

function elementClassName(
  element: HTMLElement | SVGElement | null | undefined,
): string {
  const className = element?.className
  return typeof className === "string" ? className : (className?.baseVal ?? "")
}

function expectNonCroppingFocusRing(
  element: HTMLElement | SVGElement | null | undefined,
) {
  const className = elementClassName(element)
  expect(className).toContain("focus-visible:ring-2")
  expect(className).toContain("focus-visible:ring-inset")
  expect(className).toContain("focus-visible:outline-none")
  expect(className).not.toContain("focus-visible:ring-3")
}

function expectMultilingualTooltip(
  testId: string,
  expected: string[],
  omitted: string[] = [],
) {
  const target = $(`[data-testid="${testId}"]`)
  expect(target).not.toBeNull()
  act(() => {
    target?.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: null,
      }),
    )
  })

  const tooltip = $('[data-testid="watch-language-picker-tooltip-panel"]')
  expect(tooltip).not.toBeNull()
  expect(tooltip?.getAttribute("role")).toBe("tooltip")
  expect(tooltip?.getAttribute("aria-hidden")).not.toBe("true")
  expect(tooltip?.className).toContain("w-full")
  expect(tooltip?.className).toContain("absolute")
  expect(tooltip?.className).toContain("bottom-full")
  expect(tooltip?.className).toContain("pointer-events-none")
  expect(tooltip?.className).toContain("transition-[opacity,translate]")
  expect(tooltip?.className).toContain("duration-300")
  expect(tooltip?.className).toContain("ease-out")
  expect(tooltip?.className).toContain("translate-y-0")
  expect(tooltip?.className).toContain("opacity-75")
  expect(tooltip?.className).toContain("min-h-12")
  expect(tooltip?.className).toContain("items-start")
  expect(tooltip?.className).toContain("gap-2.5")
  expect(tooltip?.className).not.toContain("px-2")
  expect(tooltip?.className).not.toContain("border")
  expect(tooltip?.className).not.toContain("bg-sky")
  expect(tooltip?.className).not.toContain("shadow")
  expect(tooltip?.className).not.toContain("ring")
  expect(tooltip?.querySelector(".flex-wrap")).not.toBeNull()
  expect(tooltip?.querySelector(".truncate")).toBeNull()
  expect(tooltip?.querySelector(".overflow-hidden")).toBeNull()
  expect(tooltip?.querySelector(".whitespace-nowrap")).not.toBeNull()
  expect(
    tooltip?.querySelector(
      '[data-testid="watch-language-picker-tooltip-globe-icon"]',
    ),
  ).not.toBeNull()
  for (const label of ["English", "中文", "हिन्दी", "Español", "العربية"]) {
    expect(tooltip?.textContent).not.toContain(label)
  }
  for (const text of expected) {
    expect(tooltip?.textContent).toContain(text)
  }
  for (const text of omitted) {
    expect(tooltip?.textContent).not.toContain(text)
  }
  return target
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

function makePlayerRef(currentTime: number) {
  const player = { currentTime } as unknown as MuxPlayerRef
  return { current: player }
}

function renderModal({
  open,
  currentLanguageSlug = "english",
  variants,
  videoSlug = "the-call",
  collectionSlug,
  playerRef = makePlayerRef(42),
  onClose = vi.fn(),
  kind,
  subtitles,
  currentSubtitleEnabled,
  currentSubtitleSlug,
  onSubtitleChange,
  languageOptionsError,
  onRetryLanguageOptions,
}: {
  open: boolean
  currentLanguageSlug?: string
  variants: LanguagePickerVariant[]
  videoSlug?: string
  collectionSlug?: string | null
  playerRef?: ReturnType<typeof makePlayerRef>
  onClose?: () => void
  kind?: "video" | "series"
  subtitles?: WatchSubtitle[]
  currentSubtitleEnabled?: boolean
  currentSubtitleSlug?: string | null
  onSubtitleChange?: (enabled: boolean, slug: string | null) => void
  languageOptionsError?: boolean
  onRetryLanguageOptions?: () => void
}) {
  act(() => {
    root.render(
      <LanguagePickerModal
        open={open}
        variants={variants}
        currentLanguageSlug={currentLanguageSlug}
        collectionSlug={collectionSlug}
        videoSlug={videoSlug}
        playerRef={playerRef}
        onClose={onClose}
        kind={kind}
        subtitles={subtitles}
        currentSubtitleEnabled={currentSubtitleEnabled}
        currentSubtitleSlug={currentSubtitleSlug}
        onSubtitleChange={onSubtitleChange}
        languageOptionsError={languageOptionsError}
        onRetryLanguageOptions={onRetryLanguageOptions}
      />,
    )
  })
  return { onClose }
}

const baseVariants = [
  makeVariant({ documentId: "v1", languageSlug: "english" }),
  makeVariant({ documentId: "v2", languageSlug: "spanish" }),
  makeVariant({ documentId: "v3", languageSlug: "french" }),
]

const isolate = (value: string) => `\u2068${value}\u2069`

describe("LanguagePickerModal — globe overlay", () => {
  it("places catalog links at the header edge and below the selector", () => {
    renderModal({ open: true, variants: baseVariants })

    const languageHeader = $(
      '[data-testid="watch-language-picker-language-header"]',
    )
    const languageSelect = $(
      '[data-testid="watch-language-picker-tooltip-language-select"]',
    )
    const selectedLanguageAction = $(
      '[data-testid="watch-language-picker-selected-language-action"]',
    )
    const allLanguagesLink = $(
      '[data-testid="watch-language-picker-all-languages-link"]',
    ) as HTMLAnchorElement
    const selectedLanguageLink = $(
      '[data-testid="watch-language-picker-selected-language-link"]',
    ) as HTMLAnchorElement

    expect(allLanguagesLink.getAttribute("href")).toBe("/languages")
    expect(selectedLanguageLink.getAttribute("href")).toBe(
      "/english.html/videos",
    )
    expect(selectedLanguageLink.getAttribute("aria-label")).toBe(
      `See all videos in ${isolate("English")}`,
    )
    expect(allLanguagesLink.textContent).toContain("See all languages")
    expect(selectedLanguageLink.textContent).toContain(
      `See all videos in ${isolate("English")}`,
    )
    expect(languageHeader?.contains(allLanguagesLink)).toBe(true)
    expect(languageHeader?.className).toContain("w-full")
    expect(allLanguagesLink.className).toContain("ml-auto")
    expect(
      selectedLanguageAction?.previousElementSibling?.contains(languageSelect),
    ).toBe(true)
    expect(selectedLanguageAction?.contains(selectedLanguageLink)).toBe(true)
    expect(selectedLanguageLink.className).toContain("min-h-11")
    expect(selectedLanguageLink.className).toContain("underline")
    expect(selectedLanguageLink.className).toContain("px-2")
    expect(selectedLanguageLink.className).toContain("py-2")
    expectNonCroppingFocusRing(allLanguagesLink)
    expectNonCroppingFocusRing(selectedLanguageLink)
  })

  it("updates the inventory link when the draft language changes", () => {
    renderModal({ open: true, variants: baseVariants })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })

    const selectedLanguageLink = $(
      '[data-testid="watch-language-picker-selected-language-link"]',
    ) as HTMLAnchorElement
    expect(selectedLanguageLink.getAttribute("href")).toBe(
      "/spanish.html/videos",
    )
    expect(selectedLanguageLink.getAttribute("aria-label")).toBe(
      `See all videos in ${isolate("Spanish")}`,
    )
    expect(selectedLanguageLink.textContent).toContain(
      `See all videos in ${isolate("Spanish")}`,
    )
  })

  it("renders Russian catalog links with the selected native language name", () => {
    setLanguagePickerCatalog(ruMessages, "ru")
    const russianVariants = [
      makeVariant({
        documentId: "v-ru",
        languageSlug: "russian",
        language: {
          coreId: "russian",
          slug: "russian",
          name: "Russian",
          nativeName: "русский",
        },
      }),
    ]

    renderModal({
      open: true,
      variants: russianVariants,
      currentLanguageSlug: "russian",
    })

    const allLanguagesLink = $(
      '[data-testid="watch-language-picker-all-languages-link"]',
    ) as HTMLAnchorElement
    const selectedLanguageLink = $(
      '[data-testid="watch-language-picker-selected-language-link"]',
    ) as HTMLAnchorElement
    const expectedInventoryLabel = `Посмотреть все видео (${isolate("русский")})`

    expect(allLanguagesLink.textContent).toContain("Посмотреть все языки")
    expect(allLanguagesLink.textContent).not.toContain("See all languages")
    expect(selectedLanguageLink.getAttribute("href")).toBe(
      "/russian.html/videos",
    )
    expect(selectedLanguageLink.getAttribute("aria-label")).toBe(
      expectedInventoryLabel,
    )
    expect(selectedLanguageLink.textContent).toContain(expectedInventoryLabel)
    expect(selectedLanguageLink.textContent).not.toContain("See all videos")
    expect(selectedLanguageLink.textContent).not.toContain("Russian")
  })

  it("falls back to the primary language name when no native name exists", () => {
    renderModal({
      open: true,
      variants: [
        makeVariant({ documentId: "v-fallback", languageSlug: "esperanto" }),
      ],
      currentLanguageSlug: "esperanto",
    })

    const selectedLanguageLink = $(
      '[data-testid="watch-language-picker-selected-language-link"]',
    ) as HTMLAnchorElement
    const expectedInventoryLabel = `See all videos in ${isolate("Esperanto")}`

    expect(selectedLanguageLink.getAttribute("href")).toBe(
      "/esperanto.html/videos",
    )
    expect(selectedLanguageLink.getAttribute("aria-label")).toBe(
      expectedInventoryLabel,
    )
    expect(selectedLanguageLink.textContent).toContain(expectedInventoryLabel)
  })

  it("isolates an LTR language name inside an RTL inventory template", () => {
    setLanguagePickerCatalog(arMessages, "ar")
    renderModal({ open: true, variants: baseVariants })

    const selectedLanguageLink = $(
      '[data-testid="watch-language-picker-selected-language-link"]',
    ) as HTMLAnchorElement
    const expectedInventoryLabel = `عرض جميع الفيديوهات باللغة ${isolate("English")}`

    expect(selectedLanguageLink.getAttribute("aria-label")).toBe(
      expectedInventoryLabel,
    )
    expect(selectedLanguageLink.textContent).toContain(expectedInventoryLabel)
  })

  it("Apply is disabled when the modal first opens", () => {
    renderModal({ open: true, variants: baseVariants })
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it("Apply enables once the user picks a different language", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
  })

  it("Apply writes the cookie BEFORE calling router.push and keeps the modal open while switching", () => {
    setLanguagePickerMessages({ switching: "Переключение..." })
    const onClose = vi.fn()
    renderModal({ open: true, variants: baseVariants, onClose })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })

    expect(writePreferredLanguageSlugMock).toHaveBeenCalledWith("spanish")
    expect(routerPushMock).toHaveBeenCalledWith(
      "/the-call.html/spanish.html?t=42&autoplay=1",
    )
    const writeOrder =
      writePreferredLanguageSlugMock.mock.invocationCallOrder[0]!
    const pushOrder = routerPushMock.mock.invocationCallOrder[0]!
    expect(writeOrder).toBeLessThan(pushOrder)
    expect(onClose).not.toHaveBeenCalled()

    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect(apply.textContent).toContain("Переключение...")
    expect(apply.textContent).not.toContain("Switching...")
  })

  it("uses t=0 when the player ref is null", () => {
    const playerRef = { current: null } as unknown as ReturnType<
      typeof makePlayerRef
    >
    renderModal({ open: true, variants: baseVariants, playerRef })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })

    expect(routerPushMock).toHaveBeenCalledWith(
      "/the-call.html/spanish.html?t=0&autoplay=1",
    )
  })

  it("Close does not write the cookie and does not navigate", () => {
    const onClose = vi.fn()
    renderModal({ open: true, variants: baseVariants, onClose })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-close"]')?.click()
    })

    expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("closes an open language dropdown on outside click without closing the modal", () => {
    const onClose = vi.fn()
    renderModal({ open: true, variants: baseVariants, onClose })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()

    act(() => {
      $('[data-slot="dialog-overlay"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      )
      $('[data-slot="dialog-overlay"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    expect($('[data-testid="watch-language-picker-modal"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes an open language dropdown on Escape without closing the modal", () => {
    const onClose = vi.fn()
    renderModal({ open: true, variants: baseVariants, onClose })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    expect($('[data-testid="watch-language-picker-modal"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("re-opening after a cancelled change resets the draft to the current language", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    // Close without applying
    act(() => {
      $('[data-testid="watch-language-picker-close"]')?.click()
    })

    // Re-render with open=false then open=true
    renderModal({ open: false, variants: baseVariants })
    renderModal({ open: true, variants: baseVariants })

    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect($('[data-testid="language-combobox-trigger"]')?.textContent).toMatch(
      /english/i,
    )
  })

  it("selecting the current language and clicking Apply is a no-op nav", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const english = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "english",
    )!
    act(() => {
      english.click()
    })
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it("renders the count of playable variants in the header", () => {
    renderModal({
      open: true,
      variants: [
        ...baseVariants,
        makeVariant({
          documentId: "v4",
          languageSlug: "german",
          published: false,
        }),
        makeVariant({ documentId: "v5", languageSlug: "italian", hls: null }),
      ],
    })
    const count = $('[data-testid="watch-language-picker-count"]')
    expect(count?.textContent).toBe("3 languages")
    expect(count?.className).toContain("text-xs")
    expect(count?.className).toContain("sm:text-sm")
    expect(count?.className).not.toContain("text-lg")
    expect(count?.className).toContain("font-normal")
    expect(count?.className).not.toContain("font-semibold")
    expect(count?.parentElement?.textContent).toContain("Language")
    expect(count?.parentElement?.className).toContain("items-center")
    expect(count?.parentElement?.className).not.toContain("justify-between")
    const languageIcon = $(
      '[data-testid="watch-language-picker-language-icon"]',
    )
    expect(languageIcon?.querySelector("svg")).not.toBeNull()
    expect(languageIcon?.className).toContain("size-8")
    expect(languageIcon?.className).not.toContain("size-10")
    expect(elementClassName(languageIcon?.querySelector("svg"))).toContain(
      "size-4",
    )
    expect(languageIcon?.className).not.toContain("rounded-full")
    expect(languageIcon?.className).not.toContain("border")
    expect(languageIcon?.className).not.toContain("bg-stone-950")
    const defaultTooltipPanel = $(
      '[data-testid="watch-language-picker-tooltip-panel"]',
    )
    expect(defaultTooltipPanel).not.toBeNull()
    expect(defaultTooltipPanel?.className).toContain("opacity-0")
    expect(defaultTooltipPanel?.className).toContain("translate-y-2")
    expect(defaultTooltipPanel?.className).toContain("absolute")
    expect(defaultTooltipPanel?.className).toContain("bottom-full")
    expect(defaultTooltipPanel?.getAttribute("aria-hidden")).toBe("true")
    const languageTooltip = expectMultilingualTooltip(
      "watch-language-picker-tooltip-language",
      ["语言", "भाषा", "Idioma", "اللغة"],
      ["Language"],
    )
    const trigger = $('[data-testid="language-combobox-trigger"]')
    expect(trigger?.className).toContain("w-full")
    expect(trigger?.className).toContain("min-h-12")
    expect(trigger?.className).toContain("px-4")
    expect(trigger?.className).toContain("py-2.5")
    expect(trigger?.className).toContain("text-sm")
    const tooltipPanel = $(
      '[data-testid="watch-language-picker-tooltip-panel"]',
    )
    expect(tooltipPanel?.compareDocumentPosition(languageTooltip!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(tooltipPanel?.compareDocumentPosition(trigger!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(languageTooltip?.className).toContain("w-full")
    expect(languageTooltip?.contains(languageIcon)).toBe(true)
    expect(languageTooltip?.contains(count)).toBe(true)
    expect(languageTooltip?.contains(trigger)).toBe(false)
    const languageSelectTooltip = expectMultilingualTooltip(
      "watch-language-picker-tooltip-language-select",
      ["语言", "भाषा", "Idioma", "اللغة"],
      ["Language"],
    )
    expect(languageSelectTooltip?.className).toContain("w-full")
    expect(languageSelectTooltip?.contains(trigger)).toBe(true)
    act(() => {
      trigger?.click()
    })
    const popover = $('[data-testid="language-combobox-popover"]')
    expect(popover).not.toBeNull()
    expect(languageSelectTooltip?.contains(popover)).toBe(false)
    expect(
      $('[data-testid="watch-language-picker-tooltip-audio-language"]'),
    ).toBeNull()
  })

  it("omits the currently selected language from tooltip translations", () => {
    renderModal({
      open: true,
      variants: baseVariants,
      currentLanguageSlug: "spanish",
    })

    expectMultilingualTooltip(
      "watch-language-picker-tooltip-language",
      ["Language", "语言", "भाषा", "اللغة"],
      ["Idioma"],
    )
  })

  it("matches the production overlay shell and renders subtitle selector data", () => {
    renderModal({
      open: true,
      variants: [
        makeVariant({ documentId: "v1", languageSlug: "english" }),
        makeVariant({ documentId: "v2", languageSlug: "spanish" }),
      ],
      subtitles: [
        {
          documentId: "sub-en",
          language: {
            slug: "english",
            name: "English",
            nativeName: null,
            bcp47: "en",
          },
          vttSrc: "https://cdn.test/english.vtt",
          primary: true,
          aiGenerated: false,
        },
      ],
      currentSubtitleEnabled: true,
      currentSubtitleSlug: "english",
    })

    const overlay = $('[data-slot="dialog-overlay"]')
    expect(overlay?.className).toContain("bg-black/85")
    expect(overlay?.className).toContain("backdrop-blur-md")

    const modal = $('[data-testid="watch-language-picker-modal"]')
    expect(modal?.className).toContain("bg-transparent")
    expect(modal?.className).toContain("h-[100svh]")
    expect(modal?.className).toContain("w-screen")
    expect(modal?.className).toContain("max-w-none")
    expect(modal?.className).toContain("overflow-x-hidden")
    expect(modal?.className).toContain("overflow-y-auto")
    expect(modal?.className).not.toContain("max-w-[min(90vw,608px)]")
    expect(modal?.className).toContain("sm:max-w-[608px]")

    expect(
      $('[data-testid="watch-language-picker-subtitle-count"]')?.textContent,
    ).toBe("1 language")
    const subtitleCount = $(
      '[data-testid="watch-language-picker-subtitle-count"]',
    )
    expect(subtitleCount?.className).toContain("text-xs")
    expect(subtitleCount?.className).toContain("sm:text-sm")
    expect(subtitleCount?.className).not.toContain("text-lg")
    expect(subtitleCount?.className).toContain("font-normal")
    expect(subtitleCount?.parentElement?.textContent).toContain("Subtitles")
    expect(subtitleCount?.parentElement?.className).toContain("items-center")
    const subtitlesIcon = $(
      '[data-testid="watch-language-picker-subtitles-icon"]',
    )
    expect(subtitlesIcon?.querySelector("svg")).not.toBeNull()
    expect(subtitlesIcon?.className).toContain("size-8")
    expect(subtitlesIcon?.className).not.toContain("size-10")
    expect(elementClassName(subtitlesIcon?.querySelector("svg"))).toContain(
      "size-4",
    )
    expect(subtitlesIcon?.className).not.toContain("rounded-full")
    expect(subtitlesIcon?.className).not.toContain("border")
    expect(subtitlesIcon?.className).not.toContain("bg-stone-950")
    const subtitlesTooltip = expectMultilingualTooltip(
      "watch-language-picker-tooltip-subtitles",
      ["字幕", "उपशीर्षक", "Subtítulos", "الترجمة"],
      ["Subtitles"],
    )
    expect(subtitlesTooltip?.className).toContain("flex-1")
    expect(subtitlesTooltip?.contains(subtitlesIcon)).toBe(true)
    expect(subtitlesTooltip?.contains(subtitleCount)).toBe(true)
    const toggle = $(
      '[data-testid="watch-language-picker-subtitles-toggle"]',
    ) as HTMLButtonElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(toggle.getAttribute("aria-label")).toBe("Subtitles On")
    expect(toggle.getAttribute("data-state")).toBe("on")
    expect(toggle.className).toContain("h-9")
    expect(toggle.className).toContain("w-16")
    expect(toggle.className).toContain("bg-stone-100")
    expectNonCroppingFocusRing(toggle)
    expect(toggle.className).not.toContain("focus-visible:outline-offset-2")
    const toggleState = $(
      '[data-testid="watch-language-picker-subtitles-toggle-state"]',
    )
    expect(toggleState?.textContent).toBe("I")
    expect(toggleState?.className).toContain("h-7")
    expect(toggleState?.className).toContain("w-7")
    expect(toggleState?.className).toContain("items-center")
    expect(toggleState?.className).toContain("justify-center")
    expect(toggleState?.className).toContain("left-1")
    expect(toggle.parentElement?.contains(subtitleCount)).toBe(false)
    expect(toggle.parentElement?.parentElement?.className).toContain(
      "items-center",
    )
    expect(toggle.parentElement?.parentElement?.className).toContain(
      "flex-wrap",
    )
    expect(toggle.parentElement?.parentElement?.className).toContain("min-w-0")
    expect(toggle.parentElement?.parentElement?.className).toContain("shrink-0")
    const subtitleHeader = $(
      '[data-testid="watch-language-picker-subtitles-header"]',
    )
    expect(subtitleHeader?.contains(subtitlesTooltip)).toBe(true)
    expect(subtitleHeader?.contains(toggle)).toBe(true)
    expect(subtitleHeader?.className).toContain("items-center")
    expect(subtitleHeader?.className).toContain("justify-between")
    expect(subtitleHeader?.className).not.toContain("flex-col")
    expect(subtitleHeader?.className).not.toContain("sm:flex-row")
    const thumb = toggle.querySelector('span[aria-hidden="true"]')
    expect(thumb?.className).toContain("size-7")
    expect(thumb?.className).toContain("translate-x-7")
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-subtitles-toggle",
      [
        "关闭字幕",
        "उपशीर्षक बंद करें",
        "Desactivar subtítulos",
        "أوقف الترجمة",
      ],
      ["Turn subtitles off"],
    )

    const triggers = $$('[data-testid="language-combobox-trigger"]')
    expect(triggers.length).toBe(2)
    expectNonCroppingFocusRing(triggers[0])
    expect(triggers[1]?.textContent).toContain("English")
    expect(triggers[1]?.className).toContain("w-full")
    expect(triggers[1]?.className).toContain("min-h-12")
    expectNonCroppingFocusRing(triggers[1])
    const subtitlesSelectTooltip = expectMultilingualTooltip(
      "watch-language-picker-tooltip-subtitles-select",
      ["字幕", "उपशीर्षक", "Subtítulos", "الترجمة"],
      ["Subtitles"],
    )
    expect(subtitlesSelectTooltip?.className).toContain("w-full")
    expect(subtitlesSelectTooltip?.contains(triggers[1])).toBe(true)
    act(() => {
      triggers[1]?.click()
    })
    const subtitlePopover = $('[data-testid="language-combobox-popover"]')
    expect(subtitlePopover).not.toBeNull()
    expect(subtitlesSelectTooltip?.contains(subtitlePopover)).toBe(false)
    expect(
      $('[data-testid="watch-language-picker-modal"]')?.contains(
        subtitlePopover,
      ),
    ).toBe(false)
    expect(
      $('[data-testid="watch-language-picker-tooltip-subtitle-language"]'),
    ).toBeNull()
    expect(
      $('[data-testid="watch-language-picker-close-action-icon"]'),
    ).not.toBeNull()
    expect($('[data-testid="watch-language-picker-apply-icon"]')).not.toBeNull()
    expect(
      $('[data-testid="watch-language-picker-close-action"]')?.className,
    ).toContain("text-xs")
    expect(
      $('[data-testid="watch-language-picker-close-action"]')?.className,
    ).toContain("h-auto")
    expect(
      $('[data-testid="watch-language-picker-close-action"]')?.className,
    ).toContain("w-40")
    expect(
      $('[data-testid="watch-language-picker-close-action"]')?.className,
    ).toContain("px-5")
    expect(
      $('[data-testid="watch-language-picker-close-action"]')?.className,
    ).toContain("py-3")
    expectNonCroppingFocusRing(
      $('[data-testid="watch-language-picker-close-action"]'),
    )
    expect(
      $('[data-testid="watch-language-picker-apply"]')?.className,
    ).toContain("w-40")
    expect(
      $('[data-testid="watch-language-picker-apply"]')?.className,
    ).toContain("px-5")
    expectNonCroppingFocusRing($('[data-testid="watch-language-picker-apply"]'))
    expectNonCroppingFocusRing($('[data-testid="watch-language-picker-close"]'))
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-close",
      ["关闭", "बंद करें", "Cerrar", "إغلاق"],
      ["Close"],
    )
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-apply",
      ["应用", "लागू करें", "Aplicar", "تطبيق"],
      ["Apply"],
    )
    expect(
      $('[data-testid="watch-language-picker-request-ai-translation"]'),
    ).toBeNull()
  })

  it("makes the subtitle switch state explicit and hides the selector when off", () => {
    renderModal({
      open: true,
      variants: baseVariants,
      subtitles: [makeSubtitle("sub-en", "english", "English")],
      currentSubtitleEnabled: false,
      currentSubtitleSlug: "english",
    })

    const toggle = $(
      '[data-testid="watch-language-picker-subtitles-toggle"]',
    ) as HTMLButtonElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(toggle.getAttribute("aria-label")).toBe("Subtitles Off")
    expect(toggle.getAttribute("data-state")).toBe("off")
    expect(toggle.className).toContain("border-stone-500/80")
    let toggleState = $(
      '[data-testid="watch-language-picker-subtitles-toggle-state"]',
    )
    expect(toggleState?.textContent).toBe("O")
    expect(toggleState?.className).toContain("right-1")
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-subtitles-toggle",
      ["打开字幕", "उपशीर्षक चालू करें", "Activar subtítulos", "شغّل الترجمة"],
      ["Turn subtitles on"],
    )
    expect($$('[data-testid="language-combobox-trigger"]').length).toBe(1)

    act(() => {
      toggle.click()
    })

    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(toggle.getAttribute("aria-label")).toBe("Subtitles On")
    expect(toggle.getAttribute("data-state")).toBe("on")
    toggleState = $(
      '[data-testid="watch-language-picker-subtitles-toggle-state"]',
    )
    expect(toggleState?.textContent).toBe("I")
    expect(toggleState?.className).toContain("left-1")
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-subtitles-toggle",
      [
        "关闭字幕",
        "उपशीर्षक बंद करें",
        "Desactivar subtítulos",
        "أوقف الترجمة",
      ],
      ["Turn subtitles off"],
    )
    const triggers = $$('[data-testid="language-combobox-trigger"]')
    expect(triggers.length).toBe(2)
    expect(triggers[1]?.textContent).toContain("English")
  })

  it("makes unavailable captions explicit while allowing translated subtitle selection", () => {
    setLanguagePickerMessages({ notAvailable: "Недоступно" })
    const onSubtitleChange = vi.fn()
    renderModal({
      open: true,
      variants: baseVariants,
      currentLanguageSlug: "english",
      subtitles: [makeSubtitle("sub-es", "spanish", "Spanish")],
      currentSubtitleEnabled: false,
      currentSubtitleSlug: null,
      onSubtitleChange,
    })

    expect(
      $('[data-testid="watch-language-picker-subtitle-count"]')?.textContent,
    ).toBe("1 language")
    expect(
      $('[data-testid="watch-language-picker-subtitles-unavailable"]'),
    ).toBeNull()
    const toggle = $(
      '[data-testid="watch-language-picker-subtitles-toggle"]',
    ) as HTMLButtonElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(toggle.getAttribute("data-state")).toBe("off")
    expect($$('[data-testid="language-combobox-trigger"]').length).toBe(1)

    act(() => {
      toggle.click()
    })

    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect($$('[data-testid="language-combobox-trigger"]').length).toBe(2)
    expect(
      $$('[data-testid="language-combobox-trigger"]')[1]?.textContent,
    ).toContain("No English Subtitles")
    const apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.disabled).toBe(true)

    act(() => {
      $$('[data-testid="language-combobox-trigger"]')[1]?.click()
    })
    const englishUnavailable = $$(
      '[data-testid="language-combobox-option"]',
    ).find((el) => el.getAttribute("data-language-slug") === "english")!
    expect(englishUnavailable).not.toBeNull()
    expect(englishUnavailable.getAttribute("aria-disabled")).toBe("true")
    expect(englishUnavailable.getAttribute("data-disabled")).toBe("true")
    expect((englishUnavailable as HTMLButtonElement).disabled).toBe(true)
    expect(englishUnavailable.textContent).toContain("English")
    expect(englishUnavailable.textContent).toContain("Недоступно")
    expect(englishUnavailable.textContent).not.toContain("Not available")

    act(() => {
      englishUnavailable.click()
    })

    expect(apply.disabled).toBe(true)
    expect(onSubtitleChange).not.toHaveBeenCalled()
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()

    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    expect(spanish.getAttribute("data-disabled")).toBe("false")
    expect((spanish as HTMLButtonElement).disabled).toBe(false)
    act(() => {
      spanish.click()
    })

    expect(apply.disabled).toBe(false)
    act(() => {
      apply.click()
    })
    expect(onSubtitleChange).toHaveBeenCalledWith(true, "spanish")
  })

  it("shows a dummy AI translation request button when subtitles are unavailable", () => {
    renderModal({ open: true, variants: baseVariants })

    const button = $(
      '[data-testid="watch-language-picker-request-ai-translation"]',
    ) as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.textContent).toBe("Translate with AI")
    expect(button.disabled).toBe(false)
    expect(button.className).toContain("border-stone-400/50")
    expect(button.className).toContain("px-3")
    expect(button.className).toContain("py-1.5")
    expect(button.className).toContain("text-[11px]")
    expect(button.className).toContain("min-w-0")
    expect(button.className).toContain("max-w-full")
    expect(button.className).toContain("flex-1")
    expect(button.className).toContain("sm:flex-none")
    expect(button.className).toContain("shrink")
    expect(button.className).toContain("whitespace-normal")
    expectNonCroppingFocusRing(button)
    expect(
      $('[data-testid="watch-language-picker-request-icon"]'),
    ).not.toBeNull()
    expect(
      $('[data-testid="watch-language-picker-request-sent-icon"]'),
    ).toBeNull()
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-request-subtitles",
      [
        "请求字幕",
        "उपशीर्षक का अनुरोध करें",
        "Solicitar subtítulos",
        "اطلب الترجمة",
      ],
      ["Request subtitles"],
    )
    const count = $('[data-testid="watch-language-picker-subtitle-count"]')
    expect(count?.parentElement?.textContent).toContain("Subtitles")
    expect(button.parentElement?.contains(count)).toBe(false)
    const toggle = $(
      '[data-testid="watch-language-picker-subtitles-toggle"]',
    ) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute("data-state")).toBe("off")
    expectMultilingualTooltip(
      "watch-language-picker-tooltip-subtitles-toggle",
      [
        "没有字幕",
        "उपशीर्षक उपलब्ध नहीं हैं",
        "Subtítulos no disponibles",
        "الترجمة غير متاحة",
      ],
      ["Subtitles unavailable"],
    )
    expect(button.parentElement?.parentElement?.contains(toggle)).toBe(true)
    expect(button.parentElement?.parentElement?.className).toContain(
      "flex-wrap",
    )
    expect(button.parentElement?.parentElement?.className).toContain("min-w-0")
    expect($$('[data-testid="language-combobox-trigger"]').length).toBe(1)

    act(() => {
      button.click()
    })

    expect(button.textContent).toBe("Request sent")
    expect(button.disabled).toBe(true)
    expect($('[data-testid="watch-language-picker-request-icon"]')).toBeNull()
    const sentIcon = $(
      '[data-testid="watch-language-picker-request-sent-icon"]',
    )
    expect(sentIcon).not.toBeNull()
    expect(elementClassName(sentIcon)).toContain("text-emerald-400")
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
  })

  it("uses a non-cropping focus ring on the language retry control", () => {
    setLanguagePickerMessages({
      retryLoadingLanguages: "Повторить загрузку языков",
    })
    const onRetryLanguageOptions = vi.fn()
    renderModal({
      open: true,
      variants: baseVariants,
      languageOptionsError: true,
      onRetryLanguageOptions,
    })

    const retry = $(
      '[data-testid="watch-language-picker-retry-languages"]',
    ) as HTMLButtonElement
    expect(retry).not.toBeNull()
    expect(retry.getAttribute("aria-label")).toBe("Повторить загрузку языков")
    expect(retry.getAttribute("title")).toBe("Повторить загрузку языков")
    expectNonCroppingFocusRing(retry)

    act(() => {
      retry.click()
    })
    expect(onRetryLanguageOptions).toHaveBeenCalledTimes(1)
  })

  it("resets the AI translation request state when the modal reopens", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="watch-language-picker-request-ai-translation"]')?.click()
    })
    expect(
      $('[data-testid="watch-language-picker-request-ai-translation"]')
        ?.textContent,
    ).toBe("Request sent")

    renderModal({ open: false, variants: baseVariants })
    renderModal({ open: true, variants: baseVariants })

    const button = $(
      '[data-testid="watch-language-picker-request-ai-translation"]',
    ) as HTMLButtonElement
    expect(button.textContent).toBe("Translate with AI")
    expect(button.disabled).toBe(false)
  })

  it("does not render when open is false", () => {
    renderModal({ open: false, variants: baseVariants })
    expect($('[data-testid="watch-language-picker-apply"]')).toBeNull()
  })
})

describe("LanguagePickerModal — in-flight navigation guard", () => {
  it("fires router.push exactly once on synchronous double-click", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    // Synchronous double-click — both clicks land in the same microtask.
    // The ref-backed guard must catch the second before it dispatches.
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })
    expect(routerPushMock).toHaveBeenCalledTimes(1)
    expect(writePreferredLanguageSlugMock).toHaveBeenCalledTimes(1)
  })

  it("clears the switching state when the current language catches up", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })

    let apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.textContent).toContain("Switching...")

    renderModal({
      open: true,
      variants: baseVariants,
      currentLanguageSlug: "spanish",
    })

    apply = $(
      '[data-testid="watch-language-picker-apply"]',
    ) as HTMLButtonElement
    expect(apply.textContent).toContain("Apply")
    expect(apply.disabled).toBe(true)
  })

  it("kind='video' (default) appends ?t and autoplay=1", () => {
    renderModal({ open: true, variants: baseVariants })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })
    expect(routerPushMock).toHaveBeenCalledWith(
      "/the-call.html/spanish.html?t=42&autoplay=1",
    )
  })

  it("kind='video' preserves collection context when collectionSlug is present", () => {
    renderModal({
      open: true,
      variants: baseVariants,
      collectionSlug: "jesus",
      videoSlug: "jesus-is-brought-to-pilate",
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })
    expect(routerPushMock).toHaveBeenCalledWith(
      "/jesus.html/jesus-is-brought-to-pilate/spanish.html?t=42&autoplay=1",
    )
  })

  it("kind='series' navigates to bare /{slug}.html/{newLang}.html (no ?t, no autoplay)", () => {
    // The series page has no player. ?t= and autoplay=1 are HeroPlayer
    // gestures; they would mistakenly trigger trailer autoplay on the
    // series destination.
    renderModal({ open: true, variants: baseVariants, kind: "series" })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })
    act(() => {
      $('[data-testid="watch-language-picker-apply"]')?.click()
    })
    expect(routerPushMock).toHaveBeenCalledWith("/the-call.html/spanish.html")
  })

  it("keeps the switching state after the old safety timeout window", () => {
    vi.useFakeTimers()
    try {
      renderModal({ open: true, variants: baseVariants })
      act(() => {
        $('[data-testid="language-combobox-trigger"]')?.click()
      })
      const spanish = $$('[data-testid="language-combobox-option"]').find(
        (el) => el.getAttribute("data-language-slug") === "spanish",
      )!
      act(() => {
        spanish.click()
      })
      act(() => {
        $('[data-testid="watch-language-picker-apply"]')?.click()
      })
      // Right after Apply, the button is in the navigating-disabled state
      // even though isDirty is still true.
      let apply = $(
        '[data-testid="watch-language-picker-apply"]',
      ) as HTMLButtonElement
      expect(apply.disabled).toBe(true)
      expect(apply.textContent).toContain("Switching...")

      // Advance past the old 5s safety-timeout window. The UI must not
      // claim the switch is idle while the App Router transition can still
      // commit and close the modal later.
      act(() => {
        vi.advanceTimersByTime(5001)
      })
      apply = $(
        '[data-testid="watch-language-picker-apply"]',
      ) as HTMLButtonElement
      expect(apply.disabled).toBe(true)
      expect(apply.textContent).toContain("Switching...")

      act(() => {
        apply.click()
      })
      expect(routerPushMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("LanguagePickerModal — selective language prefetch", () => {
  it("prefetches the selected target language path once", () => {
    renderModal({ open: true, variants: baseVariants })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })

    expect(routerPrefetchMock).toHaveBeenCalledTimes(1)
    expect(routerPrefetchMock).toHaveBeenCalledWith(
      "/the-call.html/spanish.html?t=42&autoplay=1",
    )

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanishAgain = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanishAgain.click()
    })

    expect(routerPrefetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not prefetch the current language or invalid target paths", () => {
    renderModal({ open: true, variants: baseVariants })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const english = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "english",
    )!
    act(() => {
      english.click()
    })
    expect(routerPrefetchMock).not.toHaveBeenCalled()

    renderModal({
      open: true,
      variants: baseVariants,
      videoSlug: "bad slug",
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    act(() => {
      spanish.click()
    })

    expect(routerPrefetchMock).not.toHaveBeenCalled()
  })

  it("swallows prefetch failures", async () => {
    routerPrefetchMock.mockRejectedValueOnce(new Error("prefetch failed"))
    renderModal({ open: true, variants: baseVariants })

    await act(async () => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    const spanish = $$('[data-testid="language-combobox-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )!
    await act(async () => {
      spanish.click()
    })

    expect(routerPrefetchMock).toHaveBeenCalledTimes(1)
  })
})
