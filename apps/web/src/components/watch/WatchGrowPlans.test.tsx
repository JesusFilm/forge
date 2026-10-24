// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { GROW_PLANS } from "@/lib/watch-grow-content"
import { WatchGrowPlans } from "./WatchGrowPlans"
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
  vi.unstubAllGlobals()
})
it("offers all real external plans without an account or enrollment request", () => {
  const request = vi.fn()
  vi.stubGlobal("fetch", request)
  act(() => root.render(<WatchGrowPlans />))
  expect(
    [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
  ).toEqual(GROW_PLANS.map((plan) => plan.url))
  expect(container.textContent).not.toMatch(
    /all.*Jesus Film Project|sign in|subscrib/i,
  )
  expect(request).not.toHaveBeenCalled()
})
it("filters the editorial lane grouping and restores all plans", () => {
  act(() => root.render(<WatchGrowPlans />))
  const choose = (text: string) =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    )!
  act(() => choose("Women").click())
  expect(
    [...container.querySelectorAll("a")].map((a) => a.textContent),
  ).toEqual(
    GROW_PLANS.filter((plan) => plan.lane === "Women").map(
      (plan) => plan.title,
    ),
  )
  expect(choose("Women").getAttribute("aria-pressed")).toBe("true")
  act(() => choose("All plans").click())
  expect(container.querySelectorAll("a")).toHaveLength(15)
})
