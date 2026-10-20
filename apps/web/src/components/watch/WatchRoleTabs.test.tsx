// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WatchRoleTabs } from "./WatchRoleTabs"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/watch")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

function tabs() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
}

describe("WatchRoleTabs", () => {
  it("uses arrow, Home and End keys to select and focus one roving tab", () => {
    act(() => root.render(createElement(WatchRoleTabs, null, "Panel")))
    const buttons = tabs()
    act(() => buttons[0].focus())
    for (const [key, expected] of [
      ["ArrowRight", 1],
      ["End", 3],
      ["ArrowRight", 0],
      ["ArrowLeft", 3],
      ["Home", 0],
    ] as const) {
      act(() => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        )
      })
      expect(document.activeElement).toBe(buttons[expected])
      expect(buttons.map((tab) => tab.getAttribute("aria-selected"))).toEqual(
        buttons.map((_, index) => String(index === expected)),
      )
      expect(buttons.map((tab) => tab.tabIndex)).toEqual(
        buttons.map((_, index) => (index === expected ? 0 : -1)),
      )
      const panel = container.querySelector('[role="tabpanel"]')!
      expect(panel.id).toBe(buttons[expected].getAttribute("aria-controls"))
      expect(panel.getAttribute("aria-labelledby")).toBe(buttons[expected].id)
    }
  })

  it("shares click selection across frames while keeping every DOM id unique", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(WatchRoleTabs, null, "First panel"),
          createElement(WatchRoleTabs, null, "Second panel"),
        ),
      ),
    )
    act(() => tabs()[2].click())
    expect(
      container.querySelectorAll('[role="tab"][aria-selected="true"]'),
    ).toHaveLength(2)
    expect(tabs()[6].getAttribute("aria-selected")).toBe("true")
    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(localStorage.getItem("forge.watch.role")).toBe("share")
  })

  it("renders default Explore and a reserved panel on the server", () => {
    localStorage.setItem("forge.watch.role", "partner")
    const html = renderToString(createElement(WatchRoleTabs, null, "Panel"))
    container.innerHTML = html
    expect(
      container.querySelector('[aria-selected="true"]')?.textContent,
    ).toContain("Explore faith")
    expect(container.querySelector('[role="tabpanel"]')?.className).toContain(
      "min-h-",
    )
  })
})
