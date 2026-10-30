// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WatchRoleTabs, watchRolePanelProps } from "./WatchRoleTabs"
import { useWatchRole } from "./watch-role"

/** Tabs plus the host-owned panel, wired the way the Watch hosts wire them. */
function Frame({ idBase, children }: { idBase: string; children?: string }) {
  const { role } = useWatchRole()
  return createElement(
    "div",
    null,
    createElement(WatchRoleTabs, { idBase }),
    createElement("div", watchRolePanelProps(idBase, role), children),
  )
}

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
    act(() => root.render(createElement(Frame, { idBase: "a" }, "Panel")))
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
          createElement(Frame, { idBase: "first" }, "First panel"),
          createElement(Frame, { idBase: "second" }, "Second panel"),
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

  it("renders default Explore on the server with the prototype tab classes", () => {
    localStorage.setItem("forge.watch.role", "partner")
    container.innerHTML = renderToString(
      createElement(WatchRoleTabs, { idBase: "s" }),
    )
    const selected = container.querySelector('[aria-selected="true"]')!
    expect(selected.textContent).toContain("Explore faith")
    expect(selected.className).toContain("after:border-[9px]")
    expect(selected.querySelector("svg")?.getAttribute("class")).toContain(
      "text-brand-red",
    )
    expect(selected.className).toContain("focus-visible:outline-[#2563eb]")
  })
})
