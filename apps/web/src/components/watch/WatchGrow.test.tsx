// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  WatchModalActivityProvider,
  useIsWatchModalActive,
} from "./WatchModalActivityProvider"
import { WatchGrow } from "./WatchGrow"
const state = vi.hoisted(() => ({
  active: false,
  activityAtImport: [] as boolean[],
}))
vi.mock("./WatchGrowProgressCourse", () => {
  state.activityAtImport.push(state.active)
  return {
    WatchGrowProgressCourse: () => (
      <p data-testid="deferred-course">Nine lessons ready</p>
    ),
  }
})
vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))
let root: Root
let container: HTMLDivElement
function Activity() {
  const active = useIsWatchModalActive()
  useLayoutEffect(() => {
    state.active = active
  }, [active])
  return null
}
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  )!
}
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <WatchModalActivityProvider>
        <Activity />
        <WatchGrow />
      </WatchModalActivityProvider>,
    ),
  )
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
it("keeps the large course deferred, acquires modal activity before import, and restores focus on Escape", async () => {
  expect(state.activityAtImport).toEqual([])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  const trigger = button("Open the nine lessons")
  trigger.focus()
  await act(async () => trigger.click())
  await settle()
  expect(state.activityAtImport).toEqual([true])
  expect(state.active).toBe(true)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Nine lessons ready",
  )
  expect(
    document.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby"),
  ).toBeTruthy()
  expect(
    document.querySelector('[role="dialog"]')?.contains(document.activeElement),
  ).toBe(true)
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  )
  await settle(250)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(state.active).toBe(false)
})
it("keeps the course title, open control and source available if the optimized artwork fails", () => {
  const image = container.querySelector("img")!
  act(() => image.dispatchEvent(new Event("error")))
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("Nine stories. One next step.")
  expect(button("Open the nine lessons")).toBeTruthy()
  expect(
    container.querySelector(
      'a[href="https://www.jesusfilm.org/beginning-with-jesus/materials/"]',
    ),
  ).toBeTruthy()
})
