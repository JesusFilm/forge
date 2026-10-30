// @vitest-environment jsdom
import { act, Suspense, type AnchorHTMLAttributes } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { WatchNextSteps } from "./WatchNextSteps"

const pending = vi.hoisted(() => new Promise<never>(() => {}))

// Hold each persona's first chunk open, as on a slow first tab visit.
vi.mock("next/dynamic", () => ({
  default: () =>
    function PendingPersona(): never {
      throw pending
    },
}))
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a {...props} />
  ),
}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/watch?as=explore")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

it.each(["Grow in faith", "Share your faith", "Partner with us"])(
  "keeps the route and player visible while the first %s chunk is pending",
  (label) => {
    act(() =>
      root.render(
        <Suspense fallback={<p data-testid="route-loading">Loading page</p>}>
          <main>
            <video data-testid="current-player" />
            <WatchNextSteps languageSlug="english" locale="en" />
          </main>
        </Suspense>,
      ),
    )
    const player = container.querySelector("video")!
    const tab = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((node) => node.textContent === label)!
    act(() => tab.click())

    expect(container.querySelector('[data-testid="route-loading"]')).toBeNull()
    expect(container.querySelector("main")?.style.display).not.toBe("none")
    expect(container.querySelector("video")).toBe(player)
    expect(tab.getAttribute("aria-selected")).toBe("true")
    expect(
      container.querySelector('[data-testid="watch-next-steps-panel"]'),
    ).not.toBeNull()
  },
)
