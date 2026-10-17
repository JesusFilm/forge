// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { WATCH_GROW_PRAYER } from "@/lib/watch-grow-content"
import {
  WatchModalActivityProvider,
  useIsWatchModalActive,
} from "./WatchModalActivityProvider"
import { WatchGrowPrayer } from "./WatchGrowPrayer"

vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function render() {
  act(() => root.render(<WatchGrowPrayer />))
}

it("keeps September's guide dated in October: no 'this month', no 'today', real sources", () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-17T12:00:00Z"))
  const request = vi.fn()
  vi.stubGlobal("fetch", request)
  const setItem = vi.spyOn(Storage.prototype, "setItem")
  render()
  expect(container.textContent).toContain(
    "In September 2026 we pray for Bangladesh",
  )
  expect(container.textContent).not.toContain("This month we pray")
  expect(container.querySelector("[data-today]")).toBeNull()
  expect(
    container.querySelectorAll('[data-testid="watch-grow-prayer-card"]'),
  ).toHaveLength(WATCH_GROW_PRAYER.requests.length)
  const hrefs = [...container.querySelectorAll("a")].map((a) => a.href)
  expect(hrefs).toContain(WATCH_GROW_PRAYER.pdf)
  expect(request).not.toHaveBeenCalled()
  // Ticking a prayer is page-only.
  const pray = container.querySelector<HTMLButtonElement>(
    '[data-day="1"] button[aria-pressed]',
  )!
  act(() => pray.click())
  expect(pray.getAttribute("aria-pressed")).toBe("true")
  expect(setItem).not.toHaveBeenCalled()
  setItem.mockRestore()
})

it("marks today only inside the guide's own month and shows no invented counts", () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-09-05T12:00:00"))
  render()
  expect(container.textContent).toContain("This month we pray for Bangladesh")
  expect(
    container.querySelector("[data-today]")?.getAttribute("data-day"),
  ).toBe("5")
  for (const button of container.querySelectorAll(
    '[data-testid="watch-grow-prayer-card"] button[aria-pressed]',
  )) {
    expect(button.textContent).toMatch(/^.?(Pray|Prayed)$/u)
  }
})

it("says plainly that daily prayer and mentor sign-up are unavailable, collecting nothing", async () => {
  render()
  const open = (id: string) =>
    act(() =>
      container
        .querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
        .click(),
    )
  open("watch-grow-prayer-subscribe-open")
  await act(async () => {})
  const subscribe = document.querySelector(
    '[data-testid="watch-grow-prayer-subscribe"]',
  )!
  expect(subscribe.textContent).toContain("not available")
  expect(subscribe.querySelector("input, form")).toBeNull()
  expect(subscribe.querySelector("a")?.href).toBe(WATCH_GROW_PRAYER.hub)
})

it("pauses the page player through the shared modal owner while either dialog is open", async () => {
  const seen = { active: false }
  function Probe() {
    const active = useIsWatchModalActive()
    useLayoutEffect(() => {
      seen.active = active
    }, [active])
    return null
  }
  act(() =>
    root.render(
      <WatchModalActivityProvider>
        <Probe />
        <WatchGrowPrayer />
      </WatchModalActivityProvider>,
    ),
  )
  expect(seen.active).toBe(false)
  for (const id of [
    "watch-grow-prayer-subscribe-open",
    "watch-grow-prayer-mentor-open",
  ]) {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
        .click(),
    )
    expect(seen.active).toBe(true)
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(seen.active).toBe(false)
  }
})
