// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The flow's code chunk fails to load (offline, blocked, bad deploy).
vi.mock("./WatchFindFlow", () => {
  throw new Error("chunk load failed")
})

import { WatchFindLauncher } from "./WatchFindLauncher"
import {
  WatchModalActivityProvider,
  usePauseForWatchModal,
  type WatchPausableMedia,
} from "./WatchModalActivityProvider"

let root: Root
let container: HTMLDivElement
let media: WatchPausableMedia

function Player() {
  usePauseForWatchModal(media, "original-source")
  return null
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
function button(label: string) {
  const match = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (node) =>
      node.textContent?.trim() === label ||
      node.getAttribute("aria-label") === label,
  )
  expect(match, label).toBeDefined()
  return match!
}
async function openFailed() {
  await act(async () =>
    root.render(
      <WatchModalActivityProvider>
        <WatchFindLauncher languageSlug="english" locale="en" />
        <Player />
      </WatchModalActivityProvider>,
    ),
  )
  const trigger = button("Find films for you")
  trigger.focus()
  await act(async () => trigger.click())
  await vi.waitFor(() =>
    expect(dialog()?.textContent).toContain("could not load"),
  )
  return trigger
}

beforeEach(() => {
  media = {
    paused: false,
    pause: vi.fn(() => {
      media.paused = true
    }),
    play: vi.fn(),
  }
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("Finder pending shell after a chunk failure", () => {
  it("keeps the original Close visible, contains focus and makes the page inert", async () => {
    const trigger = await openFailed()
    expect(dialog()!.textContent).toContain("Jesus Film")
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    expect(container.hasAttribute("inert")).toBe(true)
    expect(document.body.style.overflow).toBe("hidden")
    expect(media.pause).toHaveBeenCalled()
    // Tab wraps inside the overlay, both ways.
    const close = button("Close")
    const retry = button("Try again")
    close.focus()
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      ),
    )
    expect(document.activeElement).toBe(retry)
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })),
    )
    expect(document.activeElement).toBe(close)
    expect(trigger).toBeDefined()
  })

  it("dismisses with the pointer and restores the page", async () => {
    const trigger = await openFailed()
    await act(async () => button("Close").click())
    expect(dialog()).toBeNull()
    expect(container.hasAttribute("inert")).toBe(false)
    expect(document.body.style.overflow).toBe("")
    expect(document.activeElement).toBe(trigger)
  })

  it("dismisses with Escape and restores the page", async () => {
    const trigger = await openFailed()
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    )
    expect(dialog()).toBeNull()
    expect(container.hasAttribute("inert")).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(window.location.search).toBe("")
  })
})
