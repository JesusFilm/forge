import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"

vi.mock("@/i18n/client", () => ({
  useAdminI18n: () => ({
    locale: "es",
    messages: adminMessages.es,
  }),
}))

import {
  AccessRequestPageClient,
  buildAdminLoginUrl,
} from "./access-request-page-client"

describe("access request UI", () => {
  it("renders the request action when a signed request is available", () => {
    const html = renderToStaticMarkup(
      <AccessRequestPageClient
        accessStatus="available"
        accountEmail="user@example.com"
      />,
    )

    expect(html).toContain(adminMessages.es.login.access.title)
    expect(html).toContain(adminMessages.es.login.actions.requestAccess)
    expect(html).toContain("user@example.com")
  })

  it("renders an approved action when access has been granted", () => {
    const html = renderToStaticMarkup(
      <AccessRequestPageClient accessStatus="approved" />,
    )

    expect(html).toContain(adminMessages.es.login.access.approved)
    expect(html).toContain(adminMessages.es.login.actions.continueToAdmin)
    expect(html).not.toContain(adminMessages.es.login.actions.requestAccess)
  })

  it("renders a pending state when access has not been granted", () => {
    const html = renderToStaticMarkup(
      <AccessRequestPageClient accessStatus="pending" />,
    )

    expect(html).toContain(adminMessages.es.login.access.pending)
    expect(html).toContain(adminMessages.es.login.actions.checkAccessStatus)
    expect(html).not.toContain(adminMessages.es.login.actions.requestAccess)
  })

  it("renders a sign-in action without a request cookie", () => {
    const html = renderToStaticMarkup(
      <AccessRequestPageClient accessStatus="unavailable" />,
    )

    expect(html).toContain(adminMessages.es.login.access.unavailable)
    expect(html).toContain(adminMessages.es.login.actions.signInAgain)
    expect(html).toContain(adminMessages.es.login.actions.tryDifferentAccount)
    expect(html).not.toContain(adminMessages.es.login.actions.requestAccess)
  })

  it("forces a fresh login prompt for the sign-in-again URL", () => {
    const url = new URL(
      buildAdminLoginUrl("http://localhost:3003", { prompt: "login" }),
      "http://localhost:3003",
    )

    expect(url.pathname).toBe("/api/auth/login")
    expect(url.searchParams.get("prompt")).toBe("login")
    expect(url.searchParams.get("returnTo")).toBe(
      "http://localhost:3003/dashboard",
    )
  })

  it("keeps the approved continue URL as a silent auth check", () => {
    const url = new URL(
      buildAdminLoginUrl("http://localhost:3003"),
      "http://localhost:3003",
    )

    expect(url.pathname).toBe("/api/auth/login")
    expect(url.searchParams.has("prompt")).toBe(false)
    expect(url.searchParams.get("returnTo")).toBe(
      "http://localhost:3003/dashboard",
    )
  })
})
