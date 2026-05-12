/**
 * @vitest-environment jsdom
 *
 * LanguagePickerModal tests — globe-driven overlay rewrite.
 *
 * Covers:
 *  - Apply disabled until selection differs from current
 *  - Apply navigates with `/{videoSlug}/{newSlug}?t={currentTime}` (no /watch/)
 *  - Apply writes the language-preference cookie BEFORE router.push
 *  - Close does nothing besides onClose
 *  - Draft resets when the modal reopens
 *  - Selecting the current language and clicking Apply is a no-op nav
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

const { routerPushMock, writePreferredLanguageSlugMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  writePreferredLanguageSlugMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock("@/lib/language-preference-client", () => ({
  LANGUAGE_PREFERENCE_COOKIE: "forge_watch_lang",
  writePreferredLanguageSlug: writePreferredLanguageSlugMock,
}))

import {
  LanguagePickerModal,
  type LanguagePickerVariant,
} from "@/components/watch/LanguagePickerModal"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
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
      name: languageSlug,
    },
  }
  return { ...base, ...rest }
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
  playerRef = makePlayerRef(42),
  onClose = vi.fn(),
}: {
  open: boolean
  currentLanguageSlug?: string
  variants: LanguagePickerVariant[]
  videoSlug?: string
  playerRef?: ReturnType<typeof makePlayerRef>
  onClose?: () => void
}) {
  act(() => {
    root.render(
      <LanguagePickerModal
        open={open}
        variants={variants}
        currentLanguageSlug={currentLanguageSlug}
        videoSlug={videoSlug}
        playerRef={playerRef}
        onClose={onClose}
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

describe("LanguagePickerModal — globe overlay", () => {
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

  it("Apply writes the cookie BEFORE calling router.push, then closes", () => {
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
    expect(routerPushMock).toHaveBeenCalledWith("/the-call/spanish?t=42")
    const writeOrder =
      writePreferredLanguageSlugMock.mock.invocationCallOrder[0]!
    const pushOrder = routerPushMock.mock.invocationCallOrder[0]!
    expect(writeOrder).toBeLessThan(pushOrder)
    expect(onClose).toHaveBeenCalled()
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

    expect(routerPushMock).toHaveBeenCalledWith("/the-call/spanish?t=0")
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
  })

  it("does not render when open is false", () => {
    renderModal({ open: false, variants: baseVariants })
    expect($('[data-testid="watch-language-picker-apply"]')).toBeNull()
  })
})
