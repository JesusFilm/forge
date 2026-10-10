import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requireAdminSessionMock = vi.fn()

vi.mock("@/auth/session", () => ({
  requireAdminSession: () => requireAdminSessionMock(),
}))

import AdminMcpPage from "./page"

const skillsRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../plugins/jfp-admin/skills",
)

const pushStarterPrompts = [
  "Use the forge-push-campaign-drafts skill to draft a push campaign for a new video.",
  "Draft a push campaign for Mexico in English and Spanish, then give me the review link.",
  "Fix only the Spanish copy of a draft push campaign. I will paste its dashboard link.",
]

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
    expect(html).toContain("Generate a new draft Experience about hope")
    expect(html).toContain("Duplicate the Easter Experience")
    expect(html).not.toContain("Copy the JFP Admin MCP address")
    expect(html).not.toContain("install-skill-from-github.py")
    expect(html).not.toContain("Rules")
  })

  it("lists the push campaign starter prompts beside the Experience prompts", async () => {
    const html = renderToStaticMarkup(await AdminMcpPage())

    for (const prompt of pushStarterPrompts) {
      expect(html).toContain(prompt)
    }
    // One prompt names no skill, so it works for an agent without the plugin.
    expect(pushStarterPrompts.some((prompt) => !/skill/.test(prompt))).toBe(
      true,
    )
  })

  it("points every prompt that names a skill at a skill in the plugin", async () => {
    const html = renderToStaticMarkup(await AdminMcpPage())
    const named = [
      ...html.matchAll(/the ([a-z0-9]+(?:-[a-z0-9]+)+) skill/g),
    ].map((match) => match[1] ?? "")

    expect(named).toEqual(
      expect.arrayContaining([
        "forge-bulk-locale-factory",
        "forge-push-campaign-drafts",
      ]),
    )
    for (const name of named) {
      expect(existsSync(join(skillsRoot, name, "SKILL.md")), name).toBe(true)
    }
  })
})
