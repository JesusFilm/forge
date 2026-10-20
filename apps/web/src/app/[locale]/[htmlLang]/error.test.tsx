/**
 * @vitest-environment jsdom
 */
import { act } from "react"
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
    expect(alert?.textContent).toBe(
      "Failed to load experience: Something went wrong.",
    )
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
})
