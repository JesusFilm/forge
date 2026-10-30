import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
const session = vi.hoisted(() => vi.fn())
vi.mock("@/auth/session", () => ({ requireSession: session }))
vi.mock("@/auth/permissions", () => ({
  hasPermission: (principal: { role: string }) => principal.role === "ADMIN",
}))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
import CowatchInspectionPage from "./page"

describe("retired co-watch dashboard", () => {
  it("retains the permission boundary", async () => {
    session.mockResolvedValue({ role: "VIEWER" })
    await expect(CowatchInspectionPage()).rejects.toThrow("REDIRECT:/dashboard")
  })
  it("shows an explicit retirement message without querying co-watch rows", async () => {
    session.mockResolvedValue({ role: "ADMIN" })
    const html = renderToStaticMarkup(await CowatchInspectionPage())
    expect(html).toContain("Directional co-watch retired")
    expect(html).toContain(
      "Semantic and metadata recommendations remain available",
    )
  })
})
