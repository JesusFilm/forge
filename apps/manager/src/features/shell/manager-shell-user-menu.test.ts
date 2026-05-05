import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { StudioUserMenuPanel } from "./manager-shell"

describe("StudioUserMenuPanel", () => {
  it("renders the Tailwind account menu without legacy menu classes", () => {
    const markup = renderToStaticMarkup(
      React.createElement(StudioUserMenuPanel, {
        onLogout: vi.fn(),
        user: {
          email: "manager@forge.test",
          username: "manager",
        },
      }),
    )

    expect(markup).toContain("manager@forge.test")
    expect(markup).toContain("Workspace settings")
    expect(markup).toContain("Manager API keys")
    expect(markup).toContain("Access and permissions")
    expect(markup).toContain("Docs and resources")
    expect(markup).toContain("Terms and privacy")
    expect(markup).toContain("Sign out")
    expect(markup).toContain("w-[min(28rem,calc(100vw-2rem))]")
    expect(markup).toContain("rounded-[calc(var(--ds-radius)+12px)]")
    expect(markup).not.toContain("design-system-user-menu-panel")
    expect(markup).not.toContain("design-system-user-menu-group")
    expect(markup).not.toContain("design-system-user-menu-card")
  })
})
