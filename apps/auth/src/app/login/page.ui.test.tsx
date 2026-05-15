import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LoginPageClient } from "./login-page-client"

describe("auth login UI", () => {
  it("explains account-not-linked provider failures", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        callbackURL="https://admin.jesusfilm.org/dashboard"
        enabledProviders={["google"]}
        initialError="account_not_linked"
      />,
    )

    expect(html).toContain("This sign-in method is not linked yet.")
    expect(html).toContain("Sign in with the method you used before")
    expect(html).toContain("Continue with Google")
  })
})
