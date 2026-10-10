import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  getManagerShellNavigation,
  StudioThemeSwitch,
  StudioUserMenuPanel,
} from "./manager-shell"

describe("StudioThemeSwitch", () => {
  it("renders an accessible unchecked switch before hydration", () => {
    const markup = renderToStaticMarkup(React.createElement(StudioThemeSwitch))

    expect(markup).toContain('role="menuitemcheckbox"')
    expect(markup).toContain('aria-label="Switch to dark mode"')
    expect(markup).toContain('aria-checked="false"')
  })
})

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
    expect(markup).toContain("Appearance")
    expect(markup).toContain("Dark mode")
    expect(markup).toContain("Use a darker appearance")
    expect(markup).toContain('role="menuitemcheckbox"')
    expect(markup).toContain('aria-label="Switch to dark mode"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain("Sign out")
    expect(markup).toContain("w-[min(28rem,calc(100vw-2rem))]")
    expect(markup).toContain("rounded-[calc(var(--ds-radius)+12px)]")
    expect(markup).not.toContain("design-system-user-menu-panel")
    expect(markup).not.toContain("design-system-user-menu-group")
    expect(markup).not.toContain("design-system-user-menu-card")
  })

  it("exposes the operator-only Subtitle Quality Lab in Studio navigation", () => {
    expect(getManagerShellNavigation()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: "/dashboard/subtitle-lab",
          label: "Subtitle Lab",
        }),
      ]),
    )
  })
})
