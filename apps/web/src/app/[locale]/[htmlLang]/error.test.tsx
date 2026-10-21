/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "../../../../messages/en.json"
import WatchPageError from "./[...rest]/error"
import WatchLocaleError from "./error"

vi.mock("@/components/DatadogRum", () => ({
  reportDatadogRumError: vi.fn(),
}))

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
})

describe.each([
  ["watch locale", WatchLocaleError],
  ["watch page", WatchPageError],
])("%s route error boundary", (_name, Boundary) => {
  function renderBoundary(reset = vi.fn()) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <Boundary error={new Error("render failed")} reset={reset} />
        </NextIntlClientProvider>,
      )
    })
    return reset
  }

  it("announces the failure inside a single main landmark", () => {
    renderBoundary()

    expect(container.querySelectorAll("main")).toHaveLength(1)
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe("Something went wrong.")
    expect(container.querySelector("main")?.contains(alert)).toBe(true)
  })

  it("keeps the retry control inside main and wires it to reset", () => {
    const reset = renderBoundary()
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    )

    expect(container.querySelector("main")?.contains(retry ?? null)).toBe(true)
    act(() => retry?.click())
    expect(reset).toHaveBeenCalledTimes(1)
  })

  describe("focus after Try again (feat-774)", () => {
    let frames: FrameRequestCallback[]

    beforeEach(() => {
      frames = []
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        frames.push(cb)
        return frames.length
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    function flushFrames() {
      act(() => {
        for (const frame of frames.splice(0)) frame(0)
      })
    }

    // Stands in for Next's error boundary: reset() either renders the
    // recovered page or, on a second failure, a fresh error view.
    function Harness({ recovers }: { recovers: boolean }) {
      const [state, setState] = useState<"error" | "recovered" | "failed">(
        "error",
      )
      if (state === "recovered") return <main>Recovered page</main>
      return (
        <Boundary
          key={state}
          error={new Error("render failed")}
          reset={() => setState(recovers ? "recovered" : "failed")}
        />
      )
    }

    function renderAndRetry(recovers: boolean) {
      act(() => {
        root.render(
          <NextIntlClientProvider locale="en" messages={enMessages}>
            <Harness recovers={recovers} />
          </NextIntlClientProvider>,
        )
      })
      const retry = container.querySelector<HTMLButtonElement>("button")
      act(() => retry?.focus())
      act(() => retry?.click())
    }

    it("moves focus to the recovered page's main landmark, not body", () => {
      renderAndRetry(true)
      flushFrames()

      const main = container.querySelector("main")
      expect(main?.textContent).toBe("Recovered page")
      expect(document.activeElement).toBe(main)
      expect(main?.tabIndex).toBe(-1)
      expect(main?.classList.contains("outline-none")).toBe(true)
    })

    it("focuses the new Try again button when the retry fails again", () => {
      renderAndRetry(false)
      flushFrames()

      expect(document.activeElement?.textContent).toBe("Try again")
      expect(container.contains(document.activeElement)).toBe(true)
    })

    it("leaves focus alone when the user has already moved on", () => {
      const elsewhere = document.createElement("button")
      document.body.appendChild(elsewhere)
      renderAndRetry(true)
      act(() => elsewhere.focus())
      flushFrames()

      expect(document.activeElement).toBe(elsewhere)
      elsewhere.remove()
    })
  })
})
