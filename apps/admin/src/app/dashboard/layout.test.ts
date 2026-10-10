import { describe, expect, it } from "vitest"
import { canAccessAdminDashboard } from "@/app/dashboard/layout"

describe("canAccessAdminDashboard", () => {
  it("allows editor roles into admin", () => {
    expect(canAccessAdminDashboard({ id: "editor-1", role: "EDITOR" })).toBe(
      true,
    )
    expect(canAccessAdminDashboard({ id: "admin-1", role: "ADMIN" })).toBe(true)
  })

  it("blocks viewer access to admin", () => {
    expect(canAccessAdminDashboard({ id: "viewer-1", role: "VIEWER" })).toBe(
      false,
    )
  })
})
