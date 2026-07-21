import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requireAdminSessionMock = vi.fn()

vi.mock("@/auth/session", () => ({
  requireAdminSession: () => requireAdminSessionMock(),
}))

import AdminMcpPage from "./page"

describe("dashboard / mcp page", () => {
  beforeEach(() => {
    requireAdminSessionMock.mockReset()
    requireAdminSessionMock.mockResolvedValue({ id: "admin_1", role: "ADMIN" })
  })

  it("renders a clean MCP setup page with skill prompts", async () => {
    const html = renderToStaticMarkup(await AdminMcpPage())

    expect(requireAdminSessionMock).toHaveBeenCalled()
    expect(html).toContain("Connect JFP Admin to Your AI App")
    expect(html).toContain("Install the plugin")
    expect(html).toContain("Add the MCP")
    expect(html).toContain("Start an Admin workflow")
    expect(html).toContain("Codex")
    expect(html).toContain("Claude")
    expect(html).toContain("Other AI Apps")
    expect(html).toContain("Copy")
    expect(html).toContain("codex plugin marketplace add JesusFilm/forge")
    expect(html).toContain("codex plugin add jfp-admin@forge")
    expect(html).toContain("/mcp")
    expect(html).toContain("codex mcp add jfp-admin")
    expect(html).toContain("forge-bulk-locale-factory")
    expect(html).toContain("Find Experiences missing Spanish locales")
    expect(html).not.toContain("Copy the JFP Admin MCP address")
    expect(html).not.toContain("install-skill-from-github.py")
    expect(html).not.toContain("Rules")
  })
})
