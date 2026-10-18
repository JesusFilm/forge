/** @vitest-environment jsdom */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import englishMessages from "../../../messages/en.json"
import {
  SEARCH_SLOW_NOTICE_DELAY_MS,
  SearchSlowNotice,
  useSearchSlowNotice,
} from "./SearchSlowNotice"

type HookProps = { pending: boolean; resetKey: string | null }

let container: HTMLDivElement
let root: Root
let slow: boolean
let renders: number

function recordRender(value: boolean) {
  renders += 1
  slow = value
}

function HookProbe({
  pending,
  resetKey,
  onRender,
}: HookProps & { onRender: (value: boolean) => void }) {
  onRender(useSearchSlowNotice(pending, resetKey))
  return null
}

function renderProbe(props: HookProps, strict = false) {
  const probe = <HookProbe {...props} onRender={recordRender} />
  act(() => {
    root.render(strict ? <StrictMode>{probe}</StrictMode> : probe)
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  slow = false
  renders = 0
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe("useSearchSlowNotice", () => {
  it("turns on only after the search has been pending for the delay", () => {
    renderProbe({ pending: true, resetKey: "jesus" })

    advance(SEARCH_SLOW_NOTICE_DELAY_MS - 1)
    expect(slow).toBe(false)

    advance(1)
    expect(slow).toBe(true)
  })

  it("turns off when the search settles (result, error, or abort)", () => {
    renderProbe({ pending: true, resetKey: "jesus" })
    advance(SEARCH_SLOW_NOTICE_DELAY_MS)
    expect(slow).toBe(true)

    renderProbe({ pending: false, resetKey: "jesus" })
    expect(slow).toBe(false)
  })

  it("starts over for a new query while the old one is still pending", () => {
    renderProbe({ pending: true, resetKey: "jesus" })
    advance(SEARCH_SLOW_NOTICE_DELAY_MS)
    expect(slow).toBe(true)

    renderProbe({ pending: true, resetKey: "easter" })
    expect(slow).toBe(false)

    advance(SEARCH_SLOW_NOTICE_DELAY_MS - 1)
    expect(slow).toBe(false)
    advance(1)
    expect(slow).toBe(true)
  })

  it("does not show at once when the same query is retried after a slow search", () => {
    renderProbe({ pending: true, resetKey: "jesus" })
    advance(SEARCH_SLOW_NOTICE_DELAY_MS)
    renderProbe({ pending: false, resetKey: "jesus" })
    renderProbe({ pending: true, resetKey: "jesus" })

    expect(slow).toBe(false)
  })

  it("adds no renders to a fast search", () => {
    renderProbe({ pending: true, resetKey: "jesus" })
    advance(SEARCH_SLOW_NOTICE_DELAY_MS / 2)
    renderProbe({ pending: false, resetKey: "jesus" })
    const rendersAfterSettle = renders

    advance(SEARCH_SLOW_NOTICE_DELAY_MS * 3)

    expect(slow).toBe(false)
    // One render per prop change (start + settle) and nothing else.
    expect(rendersAfterSettle).toBe(2)
    expect(renders).toBe(rendersAfterSettle)
  })

  it("clears a pending timer when the notice unmounts", () => {
    renderProbe({ pending: true, resetKey: "jesus" })
    act(() => root.render(null))
    const rendersAfterUnmount = renders
    advance(8_000)
    expect(renders).toBe(rendersAfterUnmount)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("still fires under StrictMode's mount-unmount-mount cycle", () => {
    renderProbe({ pending: true, resetKey: "jesus" }, true)
    advance(SEARCH_SLOW_NOTICE_DELAY_MS)
    expect(slow).toBe(true)
  })
})

describe("SearchSlowNotice", () => {
  function notice(): Element | null {
    return container.querySelector('[data-testid="search-overlay-slow-notice"]')
  }

  it("renders the localized slow-search message only once the search is slow", () => {
    act(() => {
      root.render(<SearchSlowNotice pending resetKey="jesus" />)
    })
    expect(notice()).toBeNull()

    advance(SEARCH_SLOW_NOTICE_DELAY_MS)
    expect(notice()?.textContent).toBe(englishMessages.SearchOverlay.slowSearch)

    act(() => {
      root.render(<SearchSlowNotice pending={false} resetKey="jesus" />)
    })
    expect(notice()).toBeNull()
  })

  it("shows within the 3-5 second window the QA finding asks for", () => {
    expect(SEARCH_SLOW_NOTICE_DELAY_MS).toBeGreaterThanOrEqual(3_000)
    expect(SEARCH_SLOW_NOTICE_DELAY_MS).toBeLessThanOrEqual(5_000)
  })
})
