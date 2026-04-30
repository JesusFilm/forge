/**
 * @vitest-environment jsdom
 *
 * ShareModal tests.
 *
 * Covers:
 *  - Copy Link → clipboard contains the canonical 2-segment URL built from
 *    `NEXT_PUBLIC_CANONICAL_ORIGIN`.
 *  - Clipboard rejection → "Select and copy manually" hint appears, the
 *    field stays selectable.
 *  - The URL includes `/watch/` (this is the absolute, externally-shared
 *    URL, NOT a router.push target).
 *  - The Copy Embed surface is intentionally absent — see ShareModal.tsx
 *    docstring for the rationale (embed route was removed in the
 *    watch-page-mux-parity refit).
 *
 * `env` is mocked at the module boundary so the canonical-origin assertion
 * doesn't depend on the runtime env value.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://share.example",
  },
}))

import { ShareModal } from "@/components/watch/ShareModal"

let container: HTMLDivElement
let root: Root

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function setClipboard(impl: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: impl },
  })
}

beforeEach(() => {
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
  vi.restoreAllMocks()
})

describe("ShareModal — Copy Link", () => {
  it("renders the canonical 2-segment URL (with /watch/) in the input field", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    const input = $(
      '[data-testid="watch-share-modal-link-input"]',
    ) as HTMLInputElement
    expect(input.value).toBe("https://share.example/watch/the-call/english")
    expect(input.readOnly).toBe(true)
  })

  it("clicking Copy writes the canonical URL to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    )
    setClipboard(writeText)

    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    const copyBtn = $(
      '[data-testid="watch-share-modal-link-copy"]',
    ) as HTMLButtonElement
    await act(async () => {
      copyBtn.click()
    })

    expect(writeText).toHaveBeenCalledWith(
      "https://share.example/watch/the-call/english",
    )
    expect(copyBtn.textContent).toBe("Copied")
  })

  it("URL never contains a leading // or empty segment", () => {
    // Regression guard: earlier versions accepted `parentSlug=""` and
    // produced `${origin}/watch//${videoSlug}/${lang}`.
    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="v"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })
    const input = $(
      '[data-testid="watch-share-modal-link-input"]',
    ) as HTMLInputElement
    expect(input.value).not.toContain("//v")
    expect(input.value).not.toMatch(/\/watch\/{2,}/)
  })
})

describe("ShareModal — embed section is intentionally absent", () => {
  it("does not render an embed-snippet textarea", () => {
    // Embed route was removed in the watch-page-mux-parity refit; shipping
    // a snippet that 404s would leak broken iframes onto partner sites.
    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="v"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })
    expect($('[data-testid="watch-share-modal-embed-input"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-embed-copy"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-embed-fallback"]')).toBeNull()
  })
})

describe("ShareModal — clipboard failure", () => {
  it("shows the 'Select and copy manually' hint when clipboard rejects", async () => {
    setClipboard(() => Promise.reject(new Error("denied")))

    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="v"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    const copyBtn = $(
      '[data-testid="watch-share-modal-link-copy"]',
    ) as HTMLButtonElement
    await act(async () => {
      copyBtn.click()
    })

    const hint = $('[data-testid="watch-share-modal-link-fallback"]')
    expect(hint).not.toBeNull()
    expect(hint?.textContent ?? "").toContain("manually")
  })
})

describe("ShareModal — lifecycle", () => {
  it("does not render any modal contents when open is false", () => {
    act(() => {
      root.render(
        <ShareModal
          open={false}
          videoSlug="v"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-share-modal"]')).toBeNull()
  })
})
