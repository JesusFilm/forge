/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const searchState = vi.hoisted(() => ({ searchOpen: false }))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({
    pinned: false,
    playerChromeVisible: true,
    searchChromeVisible: true,
    searchChromeDimmed: false,
    searchOpen: searchState.searchOpen,
  }),
}))

import {
  FeedbackLauncher,
  FeedbackLoadNotice,
} from "@/components/FeedbackLauncher"

const EMBED_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScNeD3kPs7bqhV2i_QA6IMRCrs9W638TJuApb6QA4_ezQAEPA/viewform?embedded=true"

let container: HTMLDivElement
let root: Root

function launcher() {
  return document.querySelector(
    '[data-testid="feedback-launcher"]',
  ) as HTMLButtonElement | null
}

function iframe() {
  return document.querySelector(
    '[data-testid="feedback-form-iframe"]',
  ) as HTMLIFrameElement | null
}

async function flushDynamicModal() {
  await act(async () => {
    const deadline = Date.now() + 2000
    while (
      !document.querySelector('[data-testid="feedback-modal"]') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    }
  })
}

async function openFeedback() {
  const button = launcher()
  if (!button) throw new Error("Expected feedback launcher")
  act(() => {
    button.focus()
    button.click()
  })
  await flushDynamicModal()
}

beforeEach(() => {
  searchState.searchOpen = false
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<FeedbackLauncher />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("FeedbackLauncher", () => {
  it("renders a 44px icon launcher that reveals a red feedback label on hover or focus", () => {
    const button = launcher()
    const label = document.querySelector(
      '[data-testid="feedback-launcher-label"]',
    )
    expect(button).not.toBeNull()
    expect(button?.getAttribute("aria-label")).toBe("Open feedback form")
    expect(button?.querySelector(".lucide-triangle-alert")).not.toBeNull()
    expect(button?.className).toContain("h-11")
    expect(button?.className).toContain("w-11")
    expect(button?.className).toContain("overflow-hidden")
    expect(button?.className).toContain("hover:w-32")
    expect(button?.className).toContain("focus-visible:w-32")
    expect(button?.className).toContain("hover:bg-brand-red")
    expect(button?.className).toContain("focus-visible:bg-brand-red")
    expect(label?.textContent).toBe("Feedback")
    expect(label?.getAttribute("aria-hidden")).not.toBeNull()
    expect(label?.className).toContain("ml-2")
    expect(label?.className).toContain("shrink-0")
    expect(label?.className).toContain("opacity-0")
    expect(label?.className).toContain("transition-[opacity,transform]")
    expect(label?.className).toContain("group-hover:opacity-100")
    expect(label?.className).toContain("group-focus-visible:opacity-100")
    expect(button?.className).toContain(
      "bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]",
    )
    expect(button?.className).toContain(
      "left-[calc(1rem+env(safe-area-inset-left,0px))]",
    )
    expect(button?.className).toContain("safe-area-inset-bottom")
    expect(button?.className).toContain("safe-area-inset-left")
    expect(button?.className).toContain("rounded-full")
    expect(button?.className).not.toContain("top-1/2")
    expect(button?.className).not.toContain("safe-area-inset-right")
    expect(document.querySelector('[data-testid="feedback-modal"]')).toBeNull()
    expect(iframe()).toBeNull()
  })

  it("disables duplicate activation while the dialog chunk resolves", async () => {
    const button = launcher()
    if (!button) throw new Error("Expected feedback launcher")

    act(() => {
      button.focus()
      button.click()
      button.click()
    })

    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")

    await flushDynamicModal()
    expect(
      document.querySelectorAll('[data-testid="feedback-modal"]'),
    ).toHaveLength(1)
  })

  it("renders recoverable loading and error notices", () => {
    const onCancel = vi.fn()
    const retry = vi.fn()

    act(() => {
      root.render(<FeedbackLoadNotice onCancel={onCancel} isLoading />)
    })

    const loading = document.querySelector(
      '[data-testid="feedback-modal-loading"]',
    )
    expect(loading?.getAttribute("role")).toBe("status")
    expect(loading?.textContent).toContain("Loading feedback form")
    expect(loading?.className).toContain("safe-area-inset-bottom")
    expect(loading?.className).toContain("safe-area-inset-left")

    act(() => {
      root.render(
        <FeedbackLoadNotice
          error={new Error("chunk failed")}
          retry={retry}
          onCancel={onCancel}
        />,
      )
    })

    const error = document.querySelector(
      '[data-testid="feedback-modal-loading"]',
    )
    expect(error?.getAttribute("role")).toBe("alert")
    expect(error?.textContent).toContain("Feedback form could not load")

    const buttons = Array.from(error?.querySelectorAll("button") ?? [])
    act(() => {
      buttons.find((button) => button.textContent === "Retry")?.click()
      buttons.find((button) => button.textContent === "Cancel")?.click()
    })
    expect(retry).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()

    const fallback = error?.querySelector("a")
    expect(fallback?.getAttribute("href")).toBe(
      "https://forms.gle/8WddM1kuyEBznukW8",
    )
    expect(fallback?.getAttribute("rel")).toContain("noopener")
    expect(fallback?.getAttribute("rel")).toContain("noreferrer")
  })

  it("loads one hardened Google Forms iframe and a safe fallback link", async () => {
    await openFeedback()

    const formFrame = iframe()
    expect(formFrame).not.toBeNull()
    expect(formFrame?.getAttribute("src")).toBe(EMBED_URL)
    expect(formFrame?.getAttribute("title")).toBe("Submit Beta Feedback")
    expect(formFrame?.getAttribute("loading")).toBe("lazy")
    expect(formFrame?.getAttribute("sandbox")).toBe(
      "allow-forms allow-scripts allow-same-origin",
    )
    expect(formFrame?.getAttribute("referrerpolicy")).toBe("no-referrer")
    expect(formFrame?.className).toContain("opacity-0")

    act(() => {
      formFrame?.dispatchEvent(new Event("load"))
    })
    expect(formFrame?.className).toContain("opacity-100")
    expect(document.body.textContent).not.toContain("Loading Google Form")

    const fallback = document.querySelector(
      '[data-testid="feedback-fallback-link"]',
    ) as HTMLAnchorElement | null
    expect(fallback?.getAttribute("href")).toBe(
      "https://forms.gle/8WddM1kuyEBznukW8",
    )
    expect(fallback?.getAttribute("target")).toBe("_blank")
    expect(fallback?.getAttribute("rel")).toContain("noopener")
    expect(fallback?.getAttribute("rel")).toContain("noreferrer")
  })

  it("removes the iframe when the visible close control closes the dialog", async () => {
    await openFeedback()
    const button = launcher()
    const close = document.querySelector(
      '[data-testid="feedback-modal-close"]',
    ) as HTMLButtonElement | null
    expect(close?.className).toContain("size-11")

    await act(async () => {
      close?.click()
      await Promise.resolve()
    })

    expect(iframe()).toBeNull()
    const popup = document.querySelector('[data-testid="feedback-modal"]')
    expect(popup === null || popup.hasAttribute("data-closed")).toBe(true)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    })
    expect(document.activeElement).toBe(button)
  })

  it("suppresses feedback atomically while global search owns the screen", async () => {
    await openFeedback()
    expect(iframe()).not.toBeNull()

    searchState.searchOpen = true
    act(() => {
      root.render(<FeedbackLauncher />)
    })

    expect(launcher()).toBeNull()
    expect(document.querySelector('[data-testid="feedback-modal"]')).toBeNull()
    expect(iframe()).toBeNull()

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    searchState.searchOpen = false
    act(() => {
      root.render(<FeedbackLauncher />)
    })
    await act(async () => Promise.resolve())

    expect(launcher()).not.toBeNull()
    expect(iframe()).toBeNull()
  })

  it("does not open when search is already active", () => {
    searchState.searchOpen = true
    act(() => {
      root.render(<FeedbackLauncher />)
    })

    expect(launcher()).toBeNull()
    expect(document.querySelector('[data-testid="feedback-modal"]')).toBeNull()
    expect(iframe()).toBeNull()
  })
})
