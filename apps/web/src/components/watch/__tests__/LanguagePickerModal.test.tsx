/**
 * @vitest-environment jsdom
 *
 * U10 — LanguagePickerModal tests.
 *
 * Covers:
 *  - AE3 navigation: select a non-active language → router.push fires with
 *    `/{parent}/{video}/{newLang}?t={currentTime}` (no `/watch/` prefix —
 *    Next.js basePath is auto-prepended at runtime, NOT in tests).
 *  - Active row renders a visible checkmark and is marked `aria-current`.
 *  - Picking the active row closes the modal without navigating.
 *  - Defensive filter: unpublished + missing-hls variants are not rendered.
 *
 * The Mux Player ref is stubbed with a plain object exposing `currentTime`,
 * which is the only field LanguagePickerModal touches.
 *
 * Note: `@base-ui/react` Dialog renders into a portal, so DOM queries use
 * `document` (not the local container) for elements inside the modal.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

import {
  LanguagePickerModal,
  type LanguagePickerVariant,
} from "@/components/watch/LanguagePickerModal"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  routerPushMock.mockReset()
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
  // Only `currentTime` is touched by LanguagePickerModal; other fields are
  // typed via the cast so TS doesn't require the full HTMLMediaElement
  // surface for tests.
  const player = { currentTime } as unknown as MuxPlayerRef
  return { current: player }
}

describe("LanguagePickerModal — AE3 navigation", () => {
  it("renders one option per playable variant", () => {
    const variants: LanguagePickerVariant[] = [
      makeVariant({ documentId: "v1", languageSlug: "english" }),
      makeVariant({ documentId: "v2", languageSlug: "spanish" }),
      makeVariant({ documentId: "v3", languageSlug: "french" }),
    ]
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={variants}
          currentLanguageSlug="english"
          videoSlug="the-call"
          playerRef={makePlayerRef(0)}
          onClose={vi.fn()}
        />,
      )
    })

    const options = $$('[data-testid="watch-language-picker-option"]')
    expect(options.length).toBe(3)
    expect(options.map((o) => o.getAttribute("data-language-slug"))).toEqual([
      "english",
      "spanish",
      "french",
    ])
  })

  it("clicking a non-active language pushes /{video}/{newLang}?t={currentTime} (no /watch/ prefix; 2-segment route)", () => {
    const onClose = vi.fn()
    const variants: LanguagePickerVariant[] = [
      makeVariant({ documentId: "v1", languageSlug: "english" }),
      makeVariant({ documentId: "v2", languageSlug: "spanish" }),
    ]
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={variants}
          currentLanguageSlug="english"
          videoSlug="the-call"
          playerRef={makePlayerRef(42.5)}
          onClose={onClose}
        />,
      )
    })

    const spanish = $$('[data-testid="watch-language-picker-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )
    expect(spanish).not.toBeUndefined()
    act(() => {
      spanish!.click()
    })

    expect(routerPushMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith("/the-call/spanish?t=42.5")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("uses currentTime=0 when the player ref is null", () => {
    const variants: LanguagePickerVariant[] = [
      makeVariant({ documentId: "v1", languageSlug: "english" }),
      makeVariant({ documentId: "v2", languageSlug: "spanish" }),
    ]
    const playerRef: { current: MuxPlayerRef | null } = { current: null }
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={variants}
          currentLanguageSlug="english"
          videoSlug="video"
          playerRef={playerRef}
          onClose={vi.fn()}
        />,
      )
    })

    const spanish = $$('[data-testid="watch-language-picker-option"]').find(
      (el) => el.getAttribute("data-language-slug") === "spanish",
    )
    act(() => {
      spanish!.click()
    })

    expect(routerPushMock).toHaveBeenCalledWith("/video/spanish?t=0")
  })
})

describe("LanguagePickerModal — active row + checkmark", () => {
  it("renders a visible checkmark on the active row only", () => {
    const variants: LanguagePickerVariant[] = [
      makeVariant({ documentId: "v1", languageSlug: "english" }),
      makeVariant({ documentId: "v2", languageSlug: "spanish" }),
    ]
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={variants}
          currentLanguageSlug="english"
          videoSlug="v"
          playerRef={makePlayerRef(0)}
          onClose={vi.fn()}
        />,
      )
    })

    const checks = $$('[data-testid="watch-language-picker-checkmark"]')
    expect(checks.length).toBe(1)
    const active = $$('[data-testid="watch-language-picker-option"]').find(
      (el) => el.getAttribute("data-active") === "true",
    )
    expect(active?.getAttribute("data-language-slug")).toBe("english")
    expect(active?.getAttribute("aria-current")).toBe("true")
  })

  it("clicking the active row closes the modal but does not navigate", () => {
    const onClose = vi.fn()
    const variants: LanguagePickerVariant[] = [
      makeVariant({ documentId: "v1", languageSlug: "english" }),
    ]
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={variants}
          currentLanguageSlug="english"
          videoSlug="v"
          playerRef={makePlayerRef(10)}
          onClose={onClose}
        />,
      )
    })

    const english = $('[data-testid="watch-language-picker-option"]')
    act(() => {
      english!.click()
    })

    expect(routerPushMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("LanguagePickerModal — defensive filter + lifecycle", () => {
  it("drops unpublished variants and variants missing hls", () => {
    const variants: LanguagePickerVariant[] = [
      makeVariant({ documentId: "v1", languageSlug: "english" }),
      makeVariant({
        documentId: "v2",
        languageSlug: "spanish",
        published: false,
      }),
      makeVariant({ documentId: "v3", languageSlug: "french", hls: null }),
    ]
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={variants}
          currentLanguageSlug="english"
          videoSlug="v"
          playerRef={makePlayerRef(0)}
          onClose={vi.fn()}
        />,
      )
    })

    const slugs = $$('[data-testid="watch-language-picker-option"]').map((el) =>
      el.getAttribute("data-language-slug"),
    )
    expect(slugs).toEqual(["english"])
  })

  it("renders the empty-state when no playable variants remain", () => {
    act(() => {
      root.render(
        <LanguagePickerModal
          open
          variants={[]}
          currentLanguageSlug="english"
          videoSlug="v"
          playerRef={makePlayerRef(0)}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-language-picker-empty"]')).not.toBeNull()
  })

  it("does not render any modal contents when open is false", () => {
    act(() => {
      root.render(
        <LanguagePickerModal
          open={false}
          variants={[
            makeVariant({ documentId: "v1", languageSlug: "english" }),
          ]}
          currentLanguageSlug="english"
          videoSlug="v"
          playerRef={makePlayerRef(0)}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-language-picker-modal"]')).toBeNull()
  })
})
