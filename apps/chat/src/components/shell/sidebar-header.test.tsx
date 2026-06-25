// @vitest-environment jsdom

import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { SidebarHeader } from "./sidebar-header"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

type Overrides = {
  collapsed?: boolean
  closeRef?: React.RefObject<HTMLButtonElement | null>
  onToggleCollapsed?: () => void
  onCloseMobile?: () => void
}

function render(overrides: Overrides = {}) {
  const props = {
    collapsed: overrides.collapsed ?? false,
    styles: collapsedStyles(overrides.collapsed ?? false),
    closeRef: overrides.closeRef ?? createRef<HTMLButtonElement>(),
    onToggleCollapsed: overrides.onToggleCollapsed ?? (() => {}),
    onCloseMobile: overrides.onCloseMobile ?? (() => {}),
  }
  act(() => {
    root.render(<SidebarHeader {...props} />)
  })
}

function buttonByLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((b) => b.getAttribute("aria-label") === label)
}

// Throws a descriptive error (not a bare undefined deref) if the button is
// absent — mirrors app-shell.test.tsx's clickButton guard.
function clickByLabel(label: string) {
  const button = buttonByLabel(label)
  if (!button) throw new Error(`button "${label}" not found`)
  act(() => {
    button.click()
  })
}

describe("SidebarHeader", () => {
  it("shows the collapse toggle (not the expand affordance) when expanded", () => {
    render({ collapsed: false })
    expect(buttonByLabel("Collapse sidebar")).toBeTruthy()
    expect(buttonByLabel("Open sidebar")).toBeFalsy()
    expect(container.textContent).toContain("jesusfilm.ai")
  })

  it("shows the expand affordance (not the collapse toggle) when collapsed", () => {
    render({ collapsed: true })
    expect(buttonByLabel("Open sidebar")).toBeTruthy()
    expect(buttonByLabel("Collapse sidebar")).toBeFalsy()
  })

  it("fires onToggleCollapsed from the collapse toggle when expanded", () => {
    const onToggleCollapsed = vi.fn()
    render({ collapsed: false, onToggleCollapsed })
    clickByLabel("Collapse sidebar")
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it("fires onToggleCollapsed from the expand affordance when collapsed", () => {
    const onToggleCollapsed = vi.fn()
    render({ collapsed: true, onToggleCollapsed })
    clickByLabel("Open sidebar")
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it("renders the mobile close button in both collapsed states", () => {
    // The X lives in the drawer regardless of the desktop collapse flag, so it
    // must render whether expanded or collapsed.
    render({ collapsed: false })
    expect(buttonByLabel("Close sidebar")).toBeTruthy()
    render({ collapsed: true })
    expect(buttonByLabel("Close sidebar")).toBeTruthy()
  })

  it("fires onCloseMobile from the mobile close button", () => {
    const onCloseMobile = vi.fn()
    render({ onCloseMobile })
    clickByLabel("Close sidebar")
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })

  it("forwards closeRef to the mobile close button so the drawer can focus it", () => {
    const closeRef = createRef<HTMLButtonElement>()
    render({ closeRef })
    expect(closeRef.current).toBe(buttonByLabel("Close sidebar"))
  })
})
