/**
 * @vitest-environment jsdom
 *
 * ShareModal tests.
 *
 * Covers:
 *  - Copy Link → clipboard contains the public 2-segment URL resolved from
 *    `NEXT_PUBLIC_CANONICAL_ORIGIN`.
 *  - Clipboard rejection → "Select and copy manually" hint appears, the
 *    field stays selectable.
 *  - The URL includes `/watch/` (this is the absolute, externally-shared
 *    URL, NOT a router.push target).
 *  - Embed Code tab → renders an iframe snippet pointing at player.mux.com
 *    when a playbackId is provided; tab hidden when the video has no
 *    playbackId.
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
  it("renders the language-less English canonical URL in the input field", () => {
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
    expect(input.value).toBe("https://share.example/watch/the-call.html")
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
      "https://share.example/watch/the-call.html",
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

describe("ShareModal — Facebook + X share intents", () => {
  it("Facebook intent encodes the canonical URL into ?u=", () => {
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
    const fb = $(
      '[data-testid="watch-share-modal-facebook"]',
    ) as HTMLAnchorElement
    expect(fb.href).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fshare.example%2Fwatch%2Fthe-call.html",
    )
  })

  it("X intent encodes the canonical URL plus the title", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          videoTitle="The Call"
          onClose={vi.fn()}
        />,
      )
    })
    const x = $('[data-testid="watch-share-modal-x"]') as HTMLAnchorElement
    expect(x.href).toBe(
      "https://x.com/intent/tweet?url=https%3A%2F%2Fshare.example%2Fwatch%2Fthe-call.html&text=The%20Call",
    )
  })
})

describe("ShareModal — Embed Code tab", () => {
  it("hides the Embed Code tab when no playbackId is supplied", () => {
    // Without a Mux playbackId we can't build a portable player.mux.com
    // iframe, so we don't surface the tab at all rather than copy a broken
    // snippet onto partner sites.
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
    expect($('[data-testid="watch-share-modal-tab-embed"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-embed-input"]')).toBeNull()
  })

  it("clicking Embed Code reveals an iframe snippet pointing at player.mux.com", async () => {
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
          playbackId="ScBFl3LbJCViZNNdZfa4bpJCEyQr9Mw4Cpiirb7gb00E"
          onClose={vi.fn()}
        />,
      )
    })

    const embedTab = $(
      '[data-testid="watch-share-modal-tab-embed"]',
    ) as HTMLButtonElement
    expect(embedTab).not.toBeNull()

    await act(async () => {
      embedTab.click()
    })

    const textarea = $(
      '[data-testid="watch-share-modal-embed-input"]',
    ) as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.value).toContain(
      'src="https://player.mux.com/ScBFl3LbJCViZNNdZfa4bpJCEyQr9Mw4Cpiirb7gb00E"',
    )
    // Responsive wrapper: a single `<div>` that establishes a 16:9 box via
    // modern CSS `aspect-ratio` (Baseline 2021). The iframe absolute-fills
    // it. Inline styles only — no `<style>` block, no class attribute, so a
    // partner site that wraps the snippet inside its own `<style>` block
    // can't have its outer style terminated by a literal `</style>` here.
    expect(textarea.value).toContain("aspect-ratio:16/9")
    expect(textarea.value).toContain("position:absolute")
    expect(textarea.value).not.toContain("<style>")
    expect(textarea.value).not.toContain("</style>")
    expect(textarea.value).not.toContain('class="mux-embed"')
    // Modern + legacy fullscreen permissions; vendor-prefixed variants are
    // harmless on current browsers and unblock fullscreen in older WebKit /
    // Gecko hosts where partners might paste this snippet.
    expect(textarea.value).toContain("allowfullscreen")
    expect(textarea.value).toContain("webkitallowfullscreen")
    expect(textarea.value).toContain("mozallowfullscreen")
    // `frameborder` is deprecated; inline `border:0` on the iframe is the
    // canonical replacement and the snippet must not regress to the old
    // attribute.
    expect(textarea.value).toContain("border:0")
    expect(textarea.value).not.toContain("frameborder")

    const copyBtn = $(
      '[data-testid="watch-share-modal-embed-copy"]',
    ) as HTMLButtonElement
    expect(copyBtn).not.toBeNull()
    expect(copyBtn.textContent).toContain("Copy Code")

    await act(async () => {
      copyBtn.click()
    })

    expect(writeText).toHaveBeenCalledWith(textarea.value)
  })
})

describe("ShareModal — local origin fallback", () => {
  it("renders a public Copy Link and enabled social anchors on localhost", async () => {
    vi.resetModules()
    vi.doMock("@/env", () => ({
      env: {
        NEXT_PUBLIC_CANONICAL_ORIGIN: "http://localhost:3000",
      },
    }))
    const { ShareModal: ShareModalLocal } =
      await import("@/components/watch/ShareModal")

    act(() => {
      root.render(
        <ShareModalLocal
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    const fb = $('[data-testid="watch-share-modal-facebook"]')
    const x = $('[data-testid="watch-share-modal-x"]')
    expect(fb).not.toBeNull()
    expect(x).not.toBeNull()
    expect(fb?.tagName).toBe("A")
    expect(x?.tagName).toBe("A")
    expect(fb?.getAttribute("aria-label")).toBe("Share on Facebook")
    expect(x?.getAttribute("aria-label")).toBe("Share on X")
    expect((fb as HTMLAnchorElement).href).toContain(
      encodeURIComponent("https://www.jesusfilm.org/watch/the-call.html"),
    )
    expect((x as HTMLAnchorElement).href).toContain(
      encodeURIComponent("https://www.jesusfilm.org/watch/the-call.html"),
    )

    const hint = $('[data-testid="watch-share-modal-share-disabled-hint"]')
    expect(hint).toBeNull()
    const input = $(
      '[data-testid="watch-share-modal-link-input"]',
    ) as HTMLInputElement
    expect(input.value).toBe("https://www.jesusfilm.org/watch/the-call.html")

    vi.doUnmock("@/env")
    vi.resetModules()
  })

  it("keeps a valid Embed action when the share identity is invalid", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug=""
          currentLanguageSlug="english"
          playbackId="ScBFl3LbJCViZNNdZfa4bpJCEyQr9Mw4Cpiirb7gb00E"
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-share-modal-facebook"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-x"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-link-input"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-link-copy"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-embed-input"]')).not.toBeNull()
    expect($('[data-testid="watch-share-modal-embed-copy"]')).not.toBeNull()
    expect($('[data-testid="watch-share-modal-close"]')).not.toBeNull()
  })

  it("shows only Close when both share and embed identities are invalid", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug=""
          currentLanguageSlug="english"
          playbackId={null}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-share-modal-facebook"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-x"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-link-input"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-embed-input"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-link-copy"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-embed-copy"]')).toBeNull()
    expect($('[data-testid="watch-share-modal-close"]')).not.toBeNull()
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
  it("renders the close button at the viewport top-right", () => {
    const onClose = vi.fn()

    act(() => {
      root.render(
        <ShareModal
          open
          videoSlug="v"
          currentLanguageSlug="english"
          onClose={onClose}
        />,
      )
    })

    const close = $(
      '[data-testid="watch-share-modal-close"]',
    ) as HTMLButtonElement
    expect(close).not.toBeNull()
    expect(close.className).toContain("fixed")
    expect(close.style.top).toBe("max(1rem, env(safe-area-inset-top, 0px))")
    expect(close.style.right).toBe("max(1rem, env(safe-area-inset-right, 0px))")
    expect(close.className).toContain("h-[52px]")
    expect(close.className).toContain("w-12")
    expect(close.className).toContain("z-[1100]")
    expect(close.querySelector("svg")?.getAttribute("class")).toContain("h-6")

    act(() => {
      close.click()
    })

    expect(onClose).toHaveBeenCalled()
  })

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
