import { render, screen } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { createRef } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { SidebarHeader } from "./sidebar-header"

// Built per test (not at module load) so the instance never predates a future
// fake-timer install in this file — matches app-shell.test.tsx.
let user: UserEvent
beforeEach(() => {
  user = userEvent.setup()
})

type Overrides = {
  collapsed?: boolean
  closeRef?: React.RefObject<HTMLButtonElement | null>
  onToggleCollapsed?: () => void
  onCloseMobile?: () => void
}

function buildProps(overrides: Overrides = {}) {
  return {
    collapsed: overrides.collapsed ?? false,
    styles: collapsedStyles(overrides.collapsed ?? false),
    closeRef: overrides.closeRef ?? createRef<HTMLButtonElement>(),
    onToggleCollapsed: overrides.onToggleCollapsed ?? (() => {}),
    onCloseMobile: overrides.onCloseMobile ?? (() => {}),
  }
}

function renderHeader(overrides: Overrides = {}) {
  return render(<SidebarHeader {...buildProps(overrides)} />)
}

describe("SidebarHeader", () => {
  it("shows the collapse toggle (not the expand affordance) when expanded", () => {
    const { container } = renderHeader({ collapsed: false })
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open sidebar" })).toBeNull()
    expect(container).toHaveTextContent("jesusfilm.ai")
  })

  it("shows the expand affordance (not the collapse toggle) when collapsed", () => {
    renderHeader({ collapsed: true })
    expect(
      screen.getByRole("button", { name: "Open sidebar" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Collapse sidebar" }),
    ).toBeNull()
  })

  it("fires onToggleCollapsed from the collapse toggle when expanded", async () => {
    const onToggleCollapsed = vi.fn()
    renderHeader({ collapsed: false, onToggleCollapsed })
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it("fires onToggleCollapsed from the expand affordance when collapsed", async () => {
    const onToggleCollapsed = vi.fn()
    renderHeader({ collapsed: true, onToggleCollapsed })
    await user.click(screen.getByRole("button", { name: "Open sidebar" }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it("renders the mobile close button in both collapsed states", () => {
    // The X lives in the drawer regardless of the desktop collapse flag, so it
    // must render whether expanded or collapsed.
    const { rerender } = renderHeader({ collapsed: false })
    expect(
      screen.getByRole("button", { name: "Close sidebar" }),
    ).toBeInTheDocument()
    rerender(<SidebarHeader {...buildProps({ collapsed: true })} />)
    expect(
      screen.getByRole("button", { name: "Close sidebar" }),
    ).toBeInTheDocument()
  })

  it("fires onCloseMobile from the mobile close button", async () => {
    const onCloseMobile = vi.fn()
    renderHeader({ onCloseMobile })
    await user.click(screen.getByRole("button", { name: "Close sidebar" }))
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })

  it("forwards closeRef to the mobile close button so the drawer can focus it", () => {
    const closeRef = createRef<HTMLButtonElement>()
    renderHeader({ closeRef })
    expect(closeRef.current).toBe(
      screen.getByRole("button", { name: "Close sidebar" }),
    )
  })
})
