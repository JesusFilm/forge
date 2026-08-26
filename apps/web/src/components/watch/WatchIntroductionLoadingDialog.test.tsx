/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    (
      ({
        close: "Close introduction",
        loadFailed: "The introduction could not be loaded.",
        loading: "Loading the introduction...",
        retry: "Try again",
        "steps.discover.title": "Discover free films and stories",
      }) as Record<string, string>
    )[key] ?? key,
}))

import { WatchIntroductionLoadingDialog } from "@/components/watch/WatchIntroductionLoadingDialog"

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
  document.body.style.overflow = ""
})

describe("WatchIntroductionLoadingDialog", () => {
  it("owns focus, traps Tab, handles Escape, and restores scroll", () => {
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <WatchIntroductionLoadingDialog
          failed={false}
          onCancel={onCancel}
          open
        />,
      )
    })

    const dialog = container.querySelector("[role='dialog']") as HTMLElement
    const close = container.querySelector(
      "[data-testid='watch-introduction-loading-close']",
    ) as HTMLButtonElement
    expect(dialog.contains(close)).toBe(true)
    expect(document.activeElement).toBe(close)
    expect(document.body.style.overflow).toBe("hidden")

    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })),
    )
    expect(document.activeElement).toBe(close)
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    )
    expect(onCancel).toHaveBeenCalledOnce()

    act(() => root.render(null))
    expect(document.body.style.overflow).toBe("")
  })

  it("focuses and invokes retry after a load failure", () => {
    const onRetry = vi.fn()
    act(() => {
      root.render(
        <WatchIntroductionLoadingDialog
          failed
          onCancel={vi.fn()}
          onRetry={onRetry}
          open
        />,
      )
    })

    const retry = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Try again",
    ) as HTMLButtonElement
    expect(document.activeElement).toBe(retry)
    expect(container.textContent).toContain(
      "The introduction could not be loaded.",
    )
    act(() => retry.click())
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
