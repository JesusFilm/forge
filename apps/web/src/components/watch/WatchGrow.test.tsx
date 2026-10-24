// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { WatchGrow } from "./WatchGrow"

const state = vi.hoisted(() => ({ imported: 0 }))
vi.mock("./WatchGrowProgressCourse", () => {
  state.imported += 1
  return {
    WatchGrowProgressCourse: () => (
      <p data-testid="deferred-course">Nine lessons ready</p>
    ),
  }
})
vi.mock("./WatchFindLauncher", () => ({
  WatchFindButton: () => <button type="button">Find films for you</button>,
}))
vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))

let root: Root
let container: HTMLDivElement
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const citations = [
  {
    passage: {
      content:
        "Come, follow me, Jesus said, and I will send you out to fish for people. At once they left their nets and followed him.",
      humanReference: "Matthew 4:19-20",
      versionAbbreviation: "NIV",
    },
  },
] as never
function render(url: string) {
  window.history.replaceState(null, "", url)
  act(() =>
    root.render(
      <WatchGrow
        citations={citations}
        filmTitle="Fish for People"
        seriesTitle="40 Days"
        episodeCount={3}
        episodeIndex={1}
        nextEpisode={{ title: "Day 2", minutes: 4, href: "/day-2.html" }}
      />,
    ),
  )
}
beforeEach(() => {
  state.imported = 0
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it("leads with this film's next episode and one verse, without loading the course", async () => {
  render("/watch?as=grow")
  await settle()
  const grow = container.querySelector('[data-testid="watch-grow"]')!
  expect(grow.getAttribute("data-shape")).toBe("lean")
  expect(container.textContent).toContain("Tomorrow: Day 2")
  expect(container.textContent).toContain("From Matthew 4:19-20 · NIV")
  expect(container.textContent).toContain("Where does your week happen?")
  expect(container.textContent).toContain("Find films for you")
  expect(container.querySelector('a[href="?as=grow&grow=full"]')).not.toBeNull()
  expect(state.imported).toBe(0)
})

it("omits film modules honestly when the film has no series or passage", async () => {
  window.history.replaceState(null, "", "/watch?as=grow")
  act(() => root.render(<WatchGrow />))
  await settle()
  expect(container.textContent).not.toContain("Tomorrow:")
  expect(container.textContent).not.toContain("One line to carry")
  expect(container.textContent).toContain("Where does your week happen?")
})

it("shows the long shelf in the original order and loads the course there", async () => {
  render("/watch?as=grow&grow=full")
  await settle()
  const grow = container.querySelector('[data-testid="watch-grow"]')!
  expect(grow.getAttribute("data-shape")).toBe("full")
  const order = [
    "watch-grow-verse",
    "deferred-course",
    "watch-grow-steps",
    "watch-grow-plans",
    "watch-grow-prayer",
  ].map((id) => container.querySelector(`[data-testid="${id}"]`))
  expect(order.every(Boolean)).toBe(true)
  for (let i = 1; i < order.length; i++) {
    expect(
      order[i - 1]!.compareDocumentPosition(order[i]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  }
  expect(state.imported).toBe(1)
})

it("lands a sign-in return to a lesson on the long shelf", async () => {
  render("/watch?as=grow&growLesson=lesson-3")
  await settle()
  expect(
    container
      .querySelector('[data-testid="watch-grow"]')!
      .getAttribute("data-shape"),
  ).toBe("full")
})

it("shows the film's place in its series without claiming episodes were watched", async () => {
  window.history.replaceState(null, "", "/watch?as=grow")
  act(() =>
    root.render(
      <WatchGrow
        seriesTitle="40 Days"
        episodeCount={9}
        episodeIndex={3}
        nextEpisode={{ title: "Day 4", minutes: 4, href: "/day-4.html" }}
      />,
    ),
  )
  await settle()
  const card = container.querySelector('[data-testid="watch-grow-continue"]')!
  expect(card.textContent).toContain("40 Days · 3 of 9")
  expect(card.textContent).not.toMatch(/done|watched/i)
  const bar = card.querySelector('[role="img"]')!
  expect(bar.getAttribute("aria-label")).toBe("Episode 3 of 9")
  expect(bar.querySelectorAll(".bg-brand-red")).toHaveLength(1)
  expect(bar.children[2]!.className).toContain("bg-brand-red")
})
