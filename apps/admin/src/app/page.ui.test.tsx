import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"

vi.mock("@/i18n/server", () => ({
  getAdminMessages: vi.fn(async () => adminMessages.es),
}))

import HomePage from "./page"

describe("home page UI", () => {
  it("renders links from localized home dictionary", async () => {
    const html = renderToStaticMarkup(await HomePage())

    expect(html).toContain(adminMessages.es.home.title)
    expect(html).toContain(adminMessages.es.home.links.login)
    expect(html).toContain(adminMessages.es.home.links.dashboard)
    expect(html).toContain(adminMessages.es.home.links.systemStatus)
  })
})
