/** @vitest-environment jsdom */

import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => (key === "close" ? "Close" : key),
}))

import {
  WATCH_MODAL_CLOSE_INSET_STYLE,
  WatchModalViewportCloseButton,
} from "@/components/watch/WatchModalViewportCloseButton"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

describe("WatchModalViewportCloseButton", () => {
  it("owns the safe-area-aware modal top-right design rule", () => {
    const onClose = vi.fn()
    const buttonRef = createRef<HTMLButtonElement>()

    act(() => {
      root.render(
        <WatchModalViewportCloseButton
          open
          onClose={onClose}
          testId="watch-modal-close"
          buttonRef={buttonRef}
          ariaLabel="Dismiss modal"
        />,
      )
    })

    const close = document.querySelector(
      '[data-testid="watch-modal-close"]',
    ) as HTMLButtonElement
    expect(close).not.toBeNull()
    expect(close).toBe(buttonRef.current)
    expect(close.getAttribute("aria-label")).toBe("Dismiss modal")
    expect(close.style.top).toBe(WATCH_MODAL_CLOSE_INSET_STYLE.top)
    expect(close.style.right).toBe(WATCH_MODAL_CLOSE_INSET_STYLE.right)
    expect(close.className).toContain("fixed")
    expect(close.className).toContain("z-[1100]")
    expect(close.className).toContain("h-[52px]")
    expect(close.className).toContain("w-12")

    act(() => close.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("renders nothing while its modal is closed", () => {
    act(() => {
      root.render(
        <WatchModalViewportCloseButton
          open={false}
          onClose={vi.fn()}
          testId="watch-modal-close"
        />,
      )
    })

    expect(
      document.querySelector('[data-testid="watch-modal-close"]'),
    ).toBeNull()
  })

  it("escapes transformed dialog surfaces to preserve viewport positioning", () => {
    act(() => {
      root.render(
        <div data-testid="dialog-surface">
          <WatchModalViewportCloseButton
            open
            onClose={vi.fn()}
            testId="watch-modal-close"
          />
        </div>,
      )
    })

    const surface = container.querySelector('[data-testid="dialog-surface"]')
    const close = document.body.querySelector(
      '[data-testid="watch-modal-close"]',
    ) as HTMLButtonElement
    expect(surface?.contains(close)).toBe(false)
    expect(close.parentElement).toBe(document.body)
    expect(close.className).toContain("fixed")
    expect(close.style.top).toBe(WATCH_MODAL_CLOSE_INSET_STYLE.top)
    expect(close.style.right).toBe(WATCH_MODAL_CLOSE_INSET_STYLE.right)
  })

  it("portals into an explicit fullscreen container", () => {
    const fullscreenContainer = document.createElement("div")
    document.body.appendChild(fullscreenContainer)

    act(() => {
      root.render(
        <WatchModalViewportCloseButton
          open
          onClose={vi.fn()}
          testId="watch-modal-close"
          portalContainer={fullscreenContainer}
        />,
      )
    })

    expect(
      fullscreenContainer.querySelector('[data-testid="watch-modal-close"]'),
    ).not.toBeNull()
  })

  it("can remain inside an accessible dialog surface", () => {
    act(() => {
      root.render(
        <div role="dialog" data-testid="dialog-surface">
          <WatchModalViewportCloseButton
            open
            onClose={vi.fn()}
            testId="watch-modal-close"
            renderInline
          />
        </div>,
      )
    })

    const surface = container.querySelector('[data-testid="dialog-surface"]')
    const close = container.querySelector('[data-testid="watch-modal-close"]')
    expect(surface?.contains(close)).toBe(true)
    expect(close?.className).toContain("fixed")
  })
})
