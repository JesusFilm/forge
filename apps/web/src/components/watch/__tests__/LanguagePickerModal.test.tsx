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
  kind,
}: {
  open: boolean
  currentLanguageSlug?: string
  variants: LanguagePickerVariant[]
  videoSlug?: string
  playerRef?: ReturnType<typeof makePlayerRef>
  onClose?: () => void
  kind?: "video" | "series"
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
        kind={kind}
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
    expect(routerPushMock).toHaveBeenCalledWith(
      "/the-call/spanish?t=42&autoplay=1",
    )
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

    expect(routerPushMock).toHaveBeenCalledWith(
      "/the-call/spanish?t=0&autoplay=1",
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
    expect(count?.className).toContain("font-normal")
    expect(count?.className).not.toContain("font-semibold")
  })

  it("matches the production overlay shell and renders subtitle selector data", () => {
    renderModal({
      open: true,
      variants: [
        makeVariant({
          documentId: "v1",
          languageSlug: "english",
          videoEdition: {
            subtitles: [
              {
                vttSrc: "https://cdn.test/russian.vtt",
                srtSrc: null,
                language: {
                  coreId: "rus",
                  slug: "russian",
                  name: "Russian",
                },
              },
            ],
          },
        }),
        makeVariant({ documentId: "v2", languageSlug: "spanish" }),
      ],
    })

    const overlay = $('[data-slot="dialog-overlay"]')
    expect(overlay?.className).toContain("bg-black/85")
    expect(overlay?.className).toContain("backdrop-blur-md")

    const modal = $('[data-testid="watch-language-picker-modal"]')
    expect(modal?.className).toContain("bg-transparent")
    expect(modal?.className).toContain("sm:max-w-[608px]")

    expect(
      $('[data-testid="watch-language-picker-subtitle-count"]')?.textContent,
    ).toBe("1 language")
    expect(
      $('[data-testid="watch-language-picker-subtitle-count"]')?.className,
    ).toContain("font-normal")
    const toggle = $(
      '[data-testid="watch-language-picker-subtitles-toggle"]',
    ) as HTMLButtonElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(toggle.className).toContain("h-8")
    expect(toggle.className).toContain("w-[58px]")
    expect(toggle.querySelector("span")?.className).toContain("size-6")
    expect(toggle.querySelector("span")?.className).toContain("translate-x-6")

    const triggers = $$('[data-testid="language-combobox-trigger"]')
    expect(triggers.length).toBe(2)
    expect(triggers[1]?.textContent).toContain("Russian")
    expect(
      $('[data-testid="watch-language-picker-request-ai-translation"]'),
    ).toBeNull()
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
    expect(button.className).toContain("px-4")
    expect(button.className).toContain("py-2")
    const count = $('[data-testid="watch-language-picker-subtitle-count"]')
    expect(button.parentElement?.contains(count)).toBe(true)

    act(() => {
      button.click()
    })

    expect(button.textContent).toBe("Request sent")
    expect(button.disabled).toBe(true)
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
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
      "/the-call/spanish?t=42&autoplay=1",
    )
  })

  it("kind='series' navigates to bare /{slug}/{newLang} (no ?t, no autoplay)", () => {
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
    expect(routerPushMock).toHaveBeenCalledWith("/the-call/spanish")
  })

  it("releases the navigation guard after the safety timeout (~5s)", () => {
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

      // Advance past the 5s safety timeout. With currentLanguageSlug
      // never updating (no parent rerender simulates the cookie/redirect
      // stuck-navigating scenario), the guard otherwise stays set.
      act(() => {
        vi.advanceTimersByTime(5001)
      })
      apply = $(
        '[data-testid="watch-language-picker-apply"]',
      ) as HTMLButtonElement
      expect(apply.disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
