// @vitest-environment jsdom

import { act, createElement, type ReactNode, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSidebarChrome } from "./use-sidebar-chrome"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

type HookProps = Parameters<typeof useSidebarChrome>[0]
type Chrome = ReturnType<typeof useSidebarChrome>

let container: HTMLDivElement
let root: Root
let latest: Chrome

// Thin harness: calls the hook, publishes its return via `latest` from an effect
// (act() flushes it, so `latest` is current after render()), and renders the
// close button with the hook's ref so the focus-trap effect has a real target.
function Harness(props: HookProps): ReactNode {
  const chrome = useSidebarChrome(props)
  useEffect(() => {
    latest = chrome
  })
  return createElement("button", {
    type: "button",
    ref: chrome.closeRef,
    "aria-label": "Close sidebar",
  })
}

function render(props: HookProps) {
  act(() => {
    root.render(createElement(Harness, props))
  })
}

const base: HookProps = {
  collapsed: false,
  mobileOpen: false,
  onToggleCollapsed: () => {},
  onCloseMobile: () => {},
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
})

describe("useSidebarChrome", () => {
  it("clips while expanded and stops clipping once a collapsed rail has settled", () => {
    render({ ...base, collapsed: false })
    expect(latest.clip).toBe(true)

    // Collapse with no animation flag set yet: a settled collapsed rail does
    // not clip (so its tooltip can overflow).
    render({ ...base, collapsed: true })
    expect(latest.clip).toBe(false)
  })

  it("clips through the collapse animation until the width transition ends", () => {
    const onToggleCollapsed = vi.fn()
    render({ ...base, collapsed: false, onToggleCollapsed })

    // Initiating a toggle sets the animating flag immediately.
    act(() => {
      latest.handleToggleCollapsed()
    })
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)

    // Parent flips collapsed → true; clip stays true because we're animating.
    render({ ...base, collapsed: true, onToggleCollapsed })
    expect(latest.clip).toBe(true)

    // The width transition ending clears the animating flag.
    act(() => {
      latest.handleTransitionEnd({
        propertyName: "width",
      } as Parameters<Chrome["handleTransitionEnd"]>[0])
    })
    expect(latest.clip).toBe(false)
  })

  it("ignores non-width transitions when clearing the animating flag", () => {
    render({ ...base, collapsed: false })
    act(() => {
      latest.handleToggleCollapsed()
    })
    render({ ...base, collapsed: true })

    act(() => {
      latest.handleTransitionEnd({
        propertyName: "opacity",
      } as Parameters<Chrome["handleTransitionEnd"]>[0])
    })
    // Still animating — an unrelated transition must not drop the clip.
    expect(latest.clip).toBe(true)
  })

  it("falls back to clearing the animating flag after 400ms if transitionend never fires", () => {
    render({ ...base, collapsed: false })
    act(() => {
      latest.handleToggleCollapsed()
    })
    render({ ...base, collapsed: true })
    expect(latest.clip).toBe(true)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(latest.clip).toBe(false)
  })

  it("closes the mobile drawer on Escape only while open", () => {
    const onCloseMobile = vi.fn()
    render({ ...base, mobileOpen: false, onCloseMobile })

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onCloseMobile).not.toHaveBeenCalled()

    render({ ...base, mobileOpen: true, onCloseMobile })
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onCloseMobile).toHaveBeenCalledTimes(1)

    // Other keys are ignored.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    })
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })

  it("focuses the close button when the mobile drawer opens", () => {
    render({ ...base, mobileOpen: false })
    render({ ...base, mobileOpen: true })
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Close sidebar"]'),
    )
  })

  it("removes the Escape listener when the drawer closes", () => {
    const onCloseMobile = vi.fn()
    render({ ...base, mobileOpen: true, onCloseMobile })
    render({ ...base, mobileOpen: false, onCloseMobile })

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onCloseMobile).not.toHaveBeenCalled()
  })
})
