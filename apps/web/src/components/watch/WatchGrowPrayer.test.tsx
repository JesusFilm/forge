// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { WATCH_GROW_PRAYER } from "@/lib/watch-grow-content"
import { WatchGrowPrayer } from "./WatchGrowPrayer"
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
it("keeps September's actual date in October, with attribution and real sources", () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-17T12:00:00Z"))
  const request = vi.fn()
  vi.stubGlobal("fetch", request)
  act(() => root.render(<WatchGrowPrayer />))
  expect(container.textContent).toContain("September 2026")
  expect(container.textContent).toContain("Bangladesh")
  expect(container.textContent).toContain("Jesus Film Project")
  expect(container.textContent).not.toMatch(
    /this month|October|join|subscrib|sponsor/i,
  )
  expect([...container.querySelectorAll("a")].map((a) => a.href)).toEqual([
    WATCH_GROW_PRAYER.pdf,
    WATCH_GROW_PRAYER.hub,
  ])
  expect(request).not.toHaveBeenCalled()
})
it("lets an anonymous reader choose every published request without sending a prayer", () => {
  act(() => root.render(<WatchGrowPrayer />))
  const select = container.querySelector("select")!
  for (let i = 0; i < WATCH_GROW_PRAYER.requests.length; i++) {
    act(() => {
      select.value = String(i)
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.textContent).toContain(WATCH_GROW_PRAYER.requests[i])
  }
  expect(container.querySelector("form")).toBeNull()
})
it("leaves a readable prayer and the source hub when the optional PDF is absent", () => {
  act(() =>
    root.render(
      <WatchGrowPrayer guide={{ ...WATCH_GROW_PRAYER, pdf: undefined }} />,
    ),
  )
  expect(container.textContent).toContain(WATCH_GROW_PRAYER.requests[0])
  expect(container.querySelectorAll("a")).toHaveLength(1)
  expect(container.querySelector("a")?.href).toBe(WATCH_GROW_PRAYER.hub)
})
