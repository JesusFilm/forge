import { describe, expect, it } from "vitest"

import { GET, POST } from "./route"

describe("admin OAuth logout route", () => {
  it("clears admin-local OAuth cookies and redirects to Auth login", () => {
    const response = GET(new Request("http://localhost:3003/api/auth/logout"))

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/api/auth/login",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_session=;",
    )
  })

  it("supports POST for form/button logout flows", () => {
    const response = POST(new Request("http://localhost:3003/api/auth/logout"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/api/auth/login",
    )
  })
})
