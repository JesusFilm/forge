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
  expect(container.textContent).toContain(
    "A plan written for your week, not just your beliefs.",
  )
  expect(
    [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
  ).toEqual(GROW_PLANS.map((plan) => plan.url))
  expect(request).not.toHaveBeenCalled()
})
it("filters by lane with counts and restores all plans", () => {
  act(() => root.render(<WatchGrowPlans />))
  const chip = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.firstChild?.textContent === label,
    )!
  act(() => chip("Women").click())
  expect(
    [...container.querySelectorAll("a")].map(
      (a) => a.querySelector("span span")?.textContent,
    ),
  ).toEqual(
    GROW_PLANS.filter((plan) => plan.lane === "Women").map(
      (plan) => plan.title,
    ),
  )
  expect(chip("Women").getAttribute("aria-selected")).toBe("true")
  act(() => chip("All").click())
  expect(container.querySelectorAll("a")).toHaveLength(GROW_PLANS.length)
})
