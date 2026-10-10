/**
 * @vitest-environment jsdom
 *
 * Pins the live pointer-capability subscription behind the touch prefetch gate
 * (W-025). The component suites stub `matchMedia` with a fixed answer, so none
 * of them can see a device that changes capability after mount (a mouse
 * attached to a tablet, a convertible changing mode) or the listener cleanup.
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  HOVER_CAPABLE_POINTER_QUERY,
  useTouchGatedPrefetch,
} from "../useTouchGatedPrefetch"

type ChangeListener = () => void

/** A controllable MediaQueryList for the hover-capable query. */
function stubControllablePointer(initiallyHoverCapable: boolean) {
  let matches = initiallyHoverCapable
  const listeners = new Set<ChangeListener>()
  const addEventListener = vi.fn((_type: string, listener: ChangeListener) => {
    listeners.add(listener)
  })
  const removeEventListener = vi.fn(
    (_type: string, listener: ChangeListener) => {
      listeners.delete(listener)
    },
  )
  const list = {
    get matches() {
      return matches
    },
    media: HOVER_CAPABLE_POINTER_QUERY,
    addEventListener,
    removeEventListener,
  }
  // A fresh function per test, so the hook's per-function cache never serves a
  // list from an earlier test.
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) =>
      query === HOVER_CAPABLE_POINTER_QUERY
        ? list
        : {
            matches: false,
            media: query,
            addEventListener,
            removeEventListener,
          },
    ),
  )
  return {
    listeners,
    addEventListener,
    removeEventListener,
    setHoverCapable(next: boolean) {
      matches = next
      act(() => {
        for (const listener of [...listeners]) listener()
      })
    },
  }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function Probe() {
  const { prefetch } = useTouchGatedPrefetch()
  return <span data-prefetch={String(prefetch)} />
}

function prefetchValue() {
  return container.querySelector("span")?.getAttribute("data-prefetch")
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("useTouchGatedPrefetch pointer capability", () => {
  it("arms when a touch device gains a hover-capable pointer", () => {
    const pointer = stubControllablePointer(false)
    act(() => root.render(<Probe />))
    expect(prefetchValue()).toBe("false")

    pointer.setHoverCapable(true)

    expect(prefetchValue()).toBe("undefined")
  })

  it("re-gates when the hover-capable pointer goes away", () => {
    const pointer = stubControllablePointer(true)
    act(() => root.render(<Probe />))
    expect(prefetchValue()).toBe("undefined")

    pointer.setHoverCapable(false)

    expect(prefetchValue()).toBe("false")
  })

  it("removes its listener on unmount", () => {
    const pointer = stubControllablePointer(false)
    act(() => root.render(<Probe />))
    expect(pointer.listeners.size).toBe(1)

    act(() => root.unmount())

    expect(pointer.removeEventListener).toHaveBeenCalledTimes(1)
    expect(pointer.listeners.size).toBe(0)
    // afterEach unmounts again; give it a live root.
    root = createRoot(container)
  })
})
