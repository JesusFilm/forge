import { act, fireEvent, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSidebarChrome } from "./use-sidebar-chrome"

type HookProps = Parameters<typeof useSidebarChrome>[0]
type Chrome = ReturnType<typeof useSidebarChrome>

const base: HookProps = {
  collapsed: false,
  mobileOpen: false,
  onToggleCollapsed: () => {},
  onCloseMobile: () => {},
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function setup(initialProps: HookProps = base) {
  return renderHook((props: HookProps) => useSidebarChrome(props), {
    initialProps,
  })
}

describe("useSidebarChrome", () => {
  it("clips while expanded and stops clipping once a collapsed rail has settled", () => {
    const { result, rerender } = setup({ ...base, collapsed: false })
    expect(result.current.clip).toBe(true)

    // Collapse with no animation flag set yet: a settled collapsed rail does
    // not clip (so its tooltip can overflow).
    rerender({ ...base, collapsed: true })
    expect(result.current.clip).toBe(false)
  })

  it("clips through the collapse animation until the width transition ends", () => {
    const onToggleCollapsed = vi.fn()
    const { result, rerender } = setup({
      ...base,
      collapsed: false,
      onToggleCollapsed,
    })

    // Initiating a toggle sets the animating flag immediately.
    act(() => {
      result.current.handleToggleCollapsed()
    })
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)

    // Parent flips collapsed → true; clip stays true because we're animating.
    rerender({ ...base, collapsed: true, onToggleCollapsed })
    expect(result.current.clip).toBe(true)

    // The width transition ending clears the animating flag.
    act(() => {
      result.current.handleTransitionEnd({
        propertyName: "width",
      } as Parameters<Chrome["handleTransitionEnd"]>[0])
    })
    expect(result.current.clip).toBe(false)
  })

  it("ignores non-width transitions when clearing the animating flag", () => {
    const { result, rerender } = setup({ ...base, collapsed: false })
    act(() => {
      result.current.handleToggleCollapsed()
    })
    rerender({ ...base, collapsed: true })

    act(() => {
      result.current.handleTransitionEnd({
        propertyName: "opacity",
      } as Parameters<Chrome["handleTransitionEnd"]>[0])
    })
    // Still animating — an unrelated transition must not drop the clip.
    expect(result.current.clip).toBe(true)
  })

  it("falls back to clearing the animating flag after 400ms if transitionend never fires", () => {
    const { result, rerender } = setup({ ...base, collapsed: false })
    act(() => {
      result.current.handleToggleCollapsed()
    })
    rerender({ ...base, collapsed: true })
    expect(result.current.clip).toBe(true)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current.clip).toBe(false)
  })

  it("closes the mobile drawer on Escape only while open", () => {
    const onCloseMobile = vi.fn()
    const { rerender } = setup({ ...base, mobileOpen: false, onCloseMobile })

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCloseMobile).not.toHaveBeenCalled()

    rerender({ ...base, mobileOpen: true, onCloseMobile })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCloseMobile).toHaveBeenCalledTimes(1)

    // Other keys are ignored.
    fireEvent.keyDown(document, { key: "Enter" })
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })

  it("focuses the close button when the mobile drawer opens", () => {
    const { result, rerender } = setup({ ...base, mobileOpen: false })

    // The focus-trap effect targets closeRef.current; renderHook renders no DOM
    // of its own, so give the ref a real, focusable node in the document.
    const closeButton = document.createElement("button")
    closeButton.setAttribute("aria-label", "Close sidebar")
    document.body.appendChild(closeButton)
    result.current.closeRef.current = closeButton

    rerender({ ...base, mobileOpen: true })
    expect(document.activeElement).toBe(closeButton)

    closeButton.remove()
  })

  it("removes the Escape listener when the drawer closes", () => {
    const onCloseMobile = vi.fn()
    const { rerender } = setup({ ...base, mobileOpen: true, onCloseMobile })
    rerender({ ...base, mobileOpen: false, onCloseMobile })

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCloseMobile).not.toHaveBeenCalled()
  })
})
