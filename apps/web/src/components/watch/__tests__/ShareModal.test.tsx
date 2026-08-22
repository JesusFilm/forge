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

const { reportGoogleAnalyticsEvent } = vi.hoisted(() => ({
  reportGoogleAnalyticsEvent: vi.fn(),
}))

vi.mock("@/components/GoogleAnalytics", () => ({
  reportGoogleAnalyticsEvent,
}))

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
  reportGoogleAnalyticsEvent.mockClear()
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
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
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

describe("ShareModal — platform and reuse guidance", () => {
  it("explains link-post semantics before social controls and associates the active control", () => {
    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    const description = $(
      '[data-testid="watch-share-modal-link-description"]',
    ) as HTMLParagraphElement
    const facebook = $(
      '[data-testid="watch-share-modal-facebook"]',
    ) as HTMLAnchorElement
    const input = $(
      '[data-testid="watch-share-modal-link-input"]',
    ) as HTMLInputElement

    expect(description.textContent).toContain("share this Watch page")
    expect(description.textContent).toContain("do not upload the video")
    expect(
      description.compareDocumentPosition(facebook) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(input.getAttribute("aria-describedby")).toBe(description.id)
    expect(facebook.getAttribute("aria-describedby")).toBe(description.id)
  })

  it("explains website-only iframe use when Embed Code is active", () => {
    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          playbackId="ScBFl3LbJCViZNNdZfa4bpJCEyQr9Mw4Cpiirb7gb00E"
          onClose={vi.fn()}
        />,
      )
    })

    act(() => {
      $('[data-testid="watch-share-modal-tab-embed"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    const description = $(
      '[data-testid="watch-share-modal-embed-description"]',
    ) as HTMLParagraphElement
    const textarea = $(
      '[data-testid="watch-share-modal-embed-input"]',
    ) as HTMLTextAreaElement

    expect(description.textContent).toContain("iframe HTML")
    expect(description.textContent).toContain("ordinary social media post")
    expect(textarea.getAttribute("aria-describedby")).toBe(description.id)
  })

  it("routes video reuse questions to the approved FAQ and licensing intake without promising an outcome", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          usageGuidanceScope="video"
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    const guidance = $(
      '[data-testid="watch-share-modal-video-usage-guidance"]',
    ) as HTMLElement
    const screening = $(
      '[data-testid="watch-share-modal-screening-guidance"]',
    ) as HTMLAnchorElement
    const nativeUpload = $(
      '[data-testid="watch-share-modal-native-upload-guidance"]',
    ) as HTMLAnchorElement
    const clipReuse = $(
      '[data-testid="watch-share-modal-clip-reuse-guidance"]',
    ) as HTMLAnchorElement

    expect(guidance.textContent).toContain("Download or public screening")
    expect(guidance.textContent).toContain(
      "Native social upload or republication",
    )
    expect(guidance.textContent).toContain("Clip reuse in another production")
    expect(screening.href).toBe("https://www.jesusfilm.org/about/faq/")
    expect(nativeUpload.href).toBe(
      "https://form.asana.com/?k=qIsNe5Cu3-v5qriWHzwH8Q&d=657768513276",
    )
    expect(clipReuse.href).toBe(nativeUpload.href)
    expect(screening.target).toBe("_blank")
    expect(screening.rel).toContain("noopener")
    expect(nativeUpload.target).toBe("_blank")
    expect(nativeUpload.rel).toContain("noopener")
    expect(guidance.textContent?.toLowerCase()).not.toContain("approved")
    expect(guidance.textContent?.toLowerCase()).not.toContain("granted")
  })

  it("keeps generic share surfaces free of video reuse guidance", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          usageGuidanceScope="generic"
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    expect(
      $('[data-testid="watch-share-modal-video-usage-guidance"]'),
    ).toBeNull()
  })
})

describe("ShareModal — guidance analytics", () => {
  it("reports one bounded view per valid video-modal open edge", () => {
    const props = {
      usageGuidanceScope: "video" as const,
      videoSlug: "the-call",
      currentLanguageSlug: "english",
      onClose: vi.fn(),
    }

    act(() => {
      root.render(<ShareModal open {...props} videoTitle="Sensitive title" />)
    })

    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledTimes(1)
    expect(reportGoogleAnalyticsEvent).toHaveBeenLastCalledWith(
      "watch_share_guidance_viewed",
      { guidance_scope: "video", surface: "watch_share_modal" },
    )
    expect(JSON.stringify(reportGoogleAnalyticsEvent.mock.calls)).not.toContain(
      "Sensitive title",
    )

    act(() => {
      root.render(<ShareModal open {...props} videoTitle="Changed title" />)
    })
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledTimes(1)

    act(() => {
      root.render(<ShareModal open={false} {...props} />)
    })
    act(() => {
      root.render(<ShareModal open {...props} />)
    })
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledTimes(2)
  })

  it("does not report a view for generic or fully invalid modal content", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          usageGuidanceScope="generic"
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })
    expect(reportGoogleAnalyticsEvent).not.toHaveBeenCalled()

    act(() => {
      root.render(
        <ShareModal
          open
          usageGuidanceScope="video"
          videoSlug=""
          currentLanguageSlug="english"
          playbackId={null}
          onClose={vi.fn()}
        />,
      )
    })
    expect(reportGoogleAnalyticsEvent).not.toHaveBeenCalled()
  })

  it("reports licensing activation with only a static reuse type", () => {
    act(() => {
      root.render(
        <ShareModal
          open
          usageGuidanceScope="video"
          videoSlug="the-call"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })
    reportGoogleAnalyticsEvent.mockClear()

    act(() => {
      $(
        '[data-testid="watch-share-modal-native-upload-guidance"]',
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledWith(
      "watch_share_licensing_clicked",
      {
        reuse_type: "native_social_upload",
        surface: "watch_share_modal",
      },
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
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
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
    expect(textarea.getAttribute("aria-label")).toBe("Embed Code")

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

  it("connects the dual-format tabs to a labelled tabpanel and supports keyboard navigation", () => {
    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
          open
          videoSlug="the-call"
          currentLanguageSlug="english"
          playbackId="ScBFl3LbJCViZNNdZfa4bpJCEyQr9Mw4Cpiirb7gb00E"
          onClose={vi.fn()}
        />,
      )
    })

    const linkTab = $(
      '[data-testid="watch-share-modal-tab-link"]',
    ) as HTMLButtonElement
    const embedTab = $(
      '[data-testid="watch-share-modal-tab-embed"]',
    ) as HTMLButtonElement
    const panelId = linkTab.getAttribute("aria-controls")
    const panel = document.getElementById(panelId ?? "")

    expect(linkTab.id).not.toBe("")
    expect(embedTab.id).not.toBe("")
    expect(linkTab.id).not.toBe(embedTab.id)
    expect(embedTab.getAttribute("aria-controls")).toBe(panelId)
    expect(panel?.getAttribute("role")).toBe("tabpanel")
    expect(panel?.getAttribute("aria-labelledby")).toBe(linkTab.id)
    expect(linkTab.getAttribute("aria-selected")).toBe("true")
    expect(linkTab.tabIndex).toBe(0)
    expect(embedTab.tabIndex).toBe(-1)

    act(() => {
      linkTab.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      )
    })

    expect(document.activeElement).toBe(embedTab)
    expect(embedTab.getAttribute("aria-selected")).toBe("true")
    expect(embedTab.tabIndex).toBe(0)
    expect(panel?.getAttribute("aria-labelledby")).toBe(embedTab.id)
    expect($('[data-testid="watch-share-modal-embed-input"]')).not.toBeNull()

    act(() => {
      embedTab.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
      )
    })

    expect(document.activeElement).toBe(linkTab)
    expect(linkTab.getAttribute("aria-selected")).toBe("true")

    act(() => {
      linkTab.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      )
    })

    expect(document.activeElement).toBe(embedTab)

    act(() => {
      embedTab.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
      )
    })

    expect(document.activeElement).toBe(linkTab)
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
          usageGuidanceScope="generic"
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
    expect(fb?.getAttribute("aria-label")).toBe(
      "Share on Facebook (opens in a new tab)",
    )
    expect(x?.getAttribute("aria-label")).toBe(
      "Share on X (opens in a new tab)",
    )
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
          usageGuidanceScope="generic"
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
    expect(document.querySelector('[role="tablist"]')).toBeNull()
    expect(document.querySelector('[role="tabpanel"]')).toBeNull()
    expect(
      (
        $(
          '[data-testid="watch-share-modal-embed-input"]',
        ) as HTMLTextAreaElement
      ).getAttribute("aria-label"),
    ).toBe("Embed Code")
  })

  it("shows only Close when both share and embed identities are invalid", () => {
    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
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
      await Promise.resolve()
    })
    copyBtn.focus()
    expect(document.activeElement).toBe(copyBtn)
    await act(async () => {
      copyBtn.click()
    })

    const hint = $('[data-testid="watch-share-modal-link-fallback"]')
    expect(hint).not.toBeNull()
    expect(hint?.textContent ?? "").toContain("manually")

    const status = $('[data-testid="watch-share-modal-copy-status"]')
    expect(status?.getAttribute("role")).toBe("status")
    expect(status?.textContent ?? "").toContain("manually")
    expect(status?.hasAttribute("tabindex")).toBe(false)
  })

  it("announces successful copies through a non-focusable status region", async () => {
    setClipboard(() => Promise.resolve())

    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
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

    const status = $('[data-testid="watch-share-modal-copy-status"]')
    expect(status?.textContent).toBe("Copied")
    expect(status?.hasAttribute("tabindex")).toBe(false)
  })
})

describe("ShareModal — lifecycle", () => {
  it("renders the close button at the viewport top-right", () => {
    const onClose = vi.fn()

    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
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
          usageGuidanceScope="generic"
          open={false}
          videoSlug="v"
          currentLanguageSlug="english"
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-share-modal"]')).toBeNull()
  })

  it("labels link-only controls and communicates social new-tab behavior with 44px targets", () => {
    act(() => {
      root.render(
        <ShareModal
          usageGuidanceScope="generic"
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
    const facebook = $(
      '[data-testid="watch-share-modal-facebook"]',
    ) as HTMLAnchorElement
    const x = $('[data-testid="watch-share-modal-x"]') as HTMLAnchorElement

    expect(input.getAttribute("aria-label")).toBe("Share Link")
    expect(document.querySelector('[role="tablist"]')).toBeNull()
    expect(facebook.getAttribute("aria-label")).toContain("opens in a new tab")
    expect(x.getAttribute("aria-label")).toContain("opens in a new tab")
    expect(facebook.className).toContain("h-11")
    expect(facebook.className).toContain("w-11")
    expect(x.className).toContain("h-11")
    expect(x.className).toContain("w-11")
  })
})
