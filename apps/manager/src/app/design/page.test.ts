import { describe, expect, it, vi } from "vitest"

const { managerDashboardShellMock, requireAuthMock } = vi.hoisted(() => ({
  managerDashboardShellMock: vi.fn(({ children }) => ({
    props: { children },
    type: "ManagerDashboardShell",
  })),
  requireAuthMock: vi.fn(async () => ({
    email: "manager@forge.test",
    username: "manager",
  })),
}))

vi.mock("@/features/shell/manager-shell", () => ({
  ManagerDashboardShell: managerDashboardShellMock,
}))

vi.mock("@/lib/require-auth", () => ({
  requireAuth: requireAuthMock,
}))

import DesignSystemKitchenSinkPage, { metadata } from "./page"

describe("design system page", () => {
  it("renders at /design inside the authenticated Manager shell", async () => {
    const element = await DesignSystemKitchenSinkPage()

    expect(metadata.title).toBe("Design System Kitchen Sink -- Studio")
    expect(requireAuthMock).toHaveBeenCalledTimes(1)
    expect(element.type).toBe(managerDashboardShellMock)
    expect(element.props.user).toEqual({
      email: "manager@forge.test",
      username: "manager",
    })
    expect(element.props.children.type.name).toBe("DesignSystemKitchenSink")
  })
})
