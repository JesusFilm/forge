import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { LoginPageClient } from "./login-page-client"
import { isOAuthAuthorizeRequest } from "./page"

vi.mock("@/config/env", () => ({
  env: {},
}))

describe("auth login UI", () => {
  it("explains account-not-linked provider failures", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={["google"]}
        initialError="account_not_linked"
      />,
    )

    expect(html).toContain("This sign-in method is not linked yet.")
    expect(html).toContain("Sign in with the method you used before")
    expect(html).toContain("Continue with Google")
  })

  it("identifies OAuth authorize requests as the only valid login entry", () => {
    expect(
      isOAuthAuthorizeRequest({
        client_id: "jfp_admin_local",
        redirect_uri: "http://localhost:3003/api/auth/callback",
      }),
    ).toBe(true)
    expect(isOAuthAuthorizeRequest({ error: "forbidden" })).toBe(false)
  })
})
