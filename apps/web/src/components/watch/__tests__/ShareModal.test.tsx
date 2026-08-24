/** @vitest-environment jsdom */

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
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://share.example" },
}))

import { ShareModal, type ShareModalProps } from "@/components/watch/ShareModal"

const PLAYBACK_ID = "ScBFl3LbJCViZNNdZfa4bpJCEyQr9Mw4Cpiirb7gb00E"
const baseProps = {
  open: true,
  usageGuidanceScope: "video",
  videoSlug: "the-call",
  currentLanguageSlug: "english",
  videoTitle: "The Call",
  videoDescription: "A film description",
  posterUrl: null,
  playbackId: PLAYBACK_ID,
  onClose: vi.fn(),
} satisfies ShareModalProps

let container: HTMLDivElement
let root: Root

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function render(props: Partial<ShareModalProps> = {}) {
  act(() => {
    root.render(<ShareModal {...baseProps} {...props} />)
  })
}

function click(testId: string) {
  const element = $(`[data-testid="${testId}"]`) as HTMLElement
  expect(element).not.toBeNull()
  act(() => element.click())
}

function setClipboard(impl: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: impl },
  })
}

beforeEach(() => {
  reportGoogleAnalyticsEvent.mockClear()
  baseProps.onClose.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("ShareModal — jobs-first chooser", () => {
  it("starts with four video-use outcomes and no share or embed tool", () => {
    render()

    expect($("#share-chooser-heading")?.textContent).toContain(
      "What would you like to do",
    )
    expect($("[data-testid='watch-share-modal-choice-social']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-choice-direct']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-choice-offline']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-choice-website']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-link-input']")).toBeNull()
    expect($("[data-testid='watch-share-modal-embed-input']")).toBeNull()
  })

  it("opens directly on the only valid embed action", () => {
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockReturnValue(180)
    render({ videoSlug: "", playbackId: PLAYBACK_ID })

    expect($("#share-chooser-heading")).toBeNull()
    expect($("[data-testid='watch-share-modal-back']")).toBeNull()
    const textarea = $(
      "[data-testid='watch-share-modal-embed-input']",
    ) as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.style.height).toBe("180px")
    expect(textarea.style.overflowY).toBe("hidden")
    expect(document.activeElement).toBe($("#share-result-heading"))
  })

  it("keeps a fully invalid identity close-only and emits no guidance view", () => {
    render({ videoSlug: "", playbackId: null })

    expect($("#share-chooser-heading")).toBeNull()
    expect($("#share-result-heading")).toBeNull()
    expect($("[data-testid='watch-share-modal-unsure']")).toBeNull()
    expect($("[data-testid='watch-share-modal-close']")).not.toBeNull()
    expect(reportGoogleAnalyticsEvent).not.toHaveBeenCalled()
  })

  it("keeps generic series sharing focused on social and direct-link jobs", () => {
    render({ usageGuidanceScope: "generic", playbackId: null })

    expect($("[data-testid='watch-share-modal-choice-social']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-choice-direct']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-choice-offline']")).toBeNull()
    expect($("[data-testid='watch-share-modal-choice-website']")).toBeNull()

    click("watch-share-modal-choice-social")
    expect($("[data-testid='watch-share-modal-link-input']")).not.toBeNull()
    expect($("[data-testid='watch-share-modal-platform-youtube']")).toBeNull()
    expect(
      $("[data-testid='watch-share-modal-native-upload-guidance']"),
    ).toBeNull()
  })

  it("reports only bounded static intent values", () => {
    render({ videoTitle: "Sensitive title" })
    reportGoogleAnalyticsEvent.mockClear()

    click("watch-share-modal-choice-social")
    click("watch-share-modal-platform-youtube")

    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledWith(
      "watch_share_intent_selected",
      { intent: "social_media", surface: "watch_share_modal" },
    )
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledWith(
      "watch_share_intent_selected",
      { intent: "youtube", surface: "watch_share_modal" },
    )
    expect(JSON.stringify(reportGoogleAnalyticsEvent.mock.calls)).not.toContain(
      "Sensitive title",
    )
  })
})

describe("ShareModal — platform-specific guidance", () => {
  it("gives Facebook a canonical URL and link-post action", () => {
    render()
    click("watch-share-modal-choice-social")
    click("watch-share-modal-platform-facebook")

    const input = $(
      "[data-testid='watch-share-modal-link-input']",
    ) as HTMLInputElement
    const facebook = $(
      "[data-testid='watch-share-modal-facebook']",
    ) as HTMLAnchorElement
    expect(input.value).toBe("https://share.example/watch/the-call.html")
    expect(facebook.href).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fshare.example%2Fwatch%2Fthe-call.html",
    )
    expect(document.body.textContent).toContain(
      "does not upload the full video",
    )
  })

  it.each(["youtube", "instagram"])(
    "never recommends embed code for %s",
    (platform) => {
      render()
      click("watch-share-modal-choice-social")
      click(`watch-share-modal-platform-${platform}`)

      expect($("[data-testid='watch-share-modal-link-input']")).not.toBeNull()
      expect($("[data-testid='watch-share-modal-embed-input']")).toBeNull()
      expect(
        $("[data-testid='watch-share-modal-native-upload-guidance']"),
      ).not.toBeNull()
    },
  )

  it("keeps website embed in the website path and preserves the snippet", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard(writeText)
    render()
    click("watch-share-modal-choice-website")
    click("watch-share-modal-platform-embed")

    const textarea = $(
      "[data-testid='watch-share-modal-embed-input']",
    ) as HTMLTextAreaElement
    expect(textarea.value).toContain(`https://player.mux.com/${PLAYBACK_ID}`)
    expect(textarea.value).toContain("aspect-ratio:16/9")
    expect(textarea.value).not.toContain("<style>")

    await act(async () => {
      ;(
        $("[data-testid='watch-share-modal-embed-copy']") as HTMLButtonElement
      ).click()
    })
    expect(writeText).toHaveBeenCalledWith(textarea.value)
  })

  it("routes production reuse to the approved licensing intake", () => {
    render()
    click("watch-share-modal-choice-website")
    click("watch-share-modal-platform-production")

    const link = $(
      "[data-testid='watch-share-modal-clip-reuse-guidance']",
    ) as HTMLAnchorElement
    expect(link.href).toBe(
      "https://form.asana.com/?k=qIsNe5Cu3-v5qriWHzwH8Q&d=657768513276",
    )
    act(() => link.click())
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledWith(
      "watch_share_licensing_clicked",
      { reuse_type: "clip_reuse", surface: "watch_share_modal" },
    )
  })
})

describe("ShareModal — direct and offline actions", () => {
  it("copies the canonical Watch-page URL from the direct path", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard(writeText)
    render()
    click("watch-share-modal-choice-direct")

    const input = $(
      "[data-testid='watch-share-modal-link-input']",
    ) as HTMLInputElement
    expect(input.value).toBe("https://share.example/watch/the-call.html")
    await act(async () => {
      ;(
        $("[data-testid='watch-share-modal-link-copy']") as HTMLButtonElement
      ).click()
    })
    expect(writeText).toHaveBeenCalledWith(input.value)
    expect(
      $("[data-testid='watch-share-modal-copy-status']")?.textContent,
    ).toBe("Copied")
  })

  it("keeps clipboard failure recoverable", async () => {
    setClipboard(() => Promise.reject(new Error("denied")))
    render()
    click("watch-share-modal-choice-direct")
    await act(async () => {
      ;(
        $("[data-testid='watch-share-modal-link-copy']") as HTMLButtonElement
      ).click()
    })
    expect(
      $("[data-testid='watch-share-modal-link-fallback']")?.textContent,
    ).toContain("copy manually")
  })

  it("hands download intent back to the existing page-owned flow", () => {
    const onDownload = vi.fn()
    const onClose = vi.fn()
    render({ onDownload, onClose })
    click("watch-share-modal-choice-offline")
    click("watch-share-modal-open-download")

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDownload).toHaveBeenCalledTimes(1)
  })
})

describe("ShareModal — lifecycle and accessibility", () => {
  it("reports one guidance view per valid video-modal open edge", () => {
    render()
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledTimes(1)
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledWith(
      "watch_share_guidance_viewed",
      { guidance_scope: "video", surface: "watch_share_modal" },
    )

    render({ videoTitle: "Changed title" })
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledTimes(1)
    render({ open: false })
    render({ open: true })
    expect(reportGoogleAnalyticsEvent).toHaveBeenCalledTimes(2)
  })

  it("back returns to the correct parent choice", () => {
    render()
    expect(document.activeElement).toBe($("#share-chooser-heading"))
    const mobileScroll = $(
      "[data-testid='watch-share-modal-scroll']",
    ) as HTMLDivElement
    const desktopScroll = $(
      "[data-testid='watch-share-modal-step-scroll']",
    ) as HTMLDivElement
    mobileScroll.scrollTop = 200
    desktopScroll.scrollTop = 200
    click("watch-share-modal-choice-social")
    expect(document.activeElement).toBe($("#share-result-heading"))
    expect(mobileScroll.scrollTop).toBe(0)
    expect(desktopScroll.scrollTop).toBe(0)
    click("watch-share-modal-platform-facebook")
    expect(document.activeElement).toBe($("#share-result-heading"))
    click("watch-share-modal-back")
    expect(
      $("[data-testid='watch-share-modal-platform-youtube']"),
    ).not.toBeNull()
    expect(document.activeElement).toBe($("#share-result-heading"))
    click("watch-share-modal-back")
    expect($("[data-testid='watch-share-modal-choice-offline']")).not.toBeNull()
    expect(document.activeElement).toBe($("#share-chooser-heading"))
  })

  it("renders a labelled close target and nothing when closed", () => {
    render()
    const close = $(
      "[data-testid='watch-share-modal-close']",
    ) as HTMLButtonElement
    expect(close.getAttribute("aria-label")).toBe("Close")
    expect(close.className).toContain("fixed")
    expect(close.style.top).toContain("safe-area-inset-top")
    expect(close.closest('[role="dialog"]')).not.toBeNull()
    expect(close.getAttribute("aria-hidden")).toBeNull()

    render({ open: false })
    expect($("[data-testid='watch-share-modal']")).toBeNull()
  })

  it("does not offer a broken website embed when playback is unavailable", () => {
    render({ playbackId: null })
    click("watch-share-modal-choice-website")
    expect($("[data-testid='watch-share-modal-platform-embed']")).toBeNull()
    expect(
      $("[data-testid='watch-share-modal-platform-production']"),
    ).not.toBeNull()
  })

  it("announces every external link as opening a new tab", () => {
    render()
    click("watch-share-modal-choice-social")
    click("watch-share-modal-platform-facebook")

    const externalLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'),
    )
    expect(externalLinks.length).toBeGreaterThan(0)
    for (const link of externalLinks) {
      expect(link.textContent).toContain("opens in a new tab")
      expect(link.rel).toContain("noopener")
      expect(link.rel).toContain("noreferrer")
    }
  })
})
