import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { LoginPageClient } from "./login-page-client"
import { isOAuthAuthorizeRequest } from "./login-page-data"

vi.mock("@/config/env", () => ({
  env: {},
}))

describe("auth login UI", () => {
  it("explains account-not-linked provider failures", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={["google"]}
        initialError="account_not_linked"
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain("This login method is not linked yet.")
    expect(html).toContain("Log in with the method you used before")
    expect(html).toContain("Continue with Google")
    expect(html).toContain(
      'name="oauth_query" value="client_id=jfp_admin_local&amp;sig=signed"',
    )
  })

  it("shows the generic invalid credentials message", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        initialError="credentials"
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain("Invalid email or password.")
    expect(html).toContain("Check your email and password, then try again.")
  })

  it("shows disabled provider buttons when provider keys are unavailable", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={["google"]}
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain("Continue with Facebook")
    expect(html).toContain("Continue with Google")
    expect(html).toContain("Continue with Apple")
    expect(html).toContain("Continue with Okta")
    expect(html).toContain("disabled")
  })

  it("places provider buttons before the email form divider", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={["google"]}
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html.indexOf("Continue with Google")).toBeLessThan(
      html.indexOf("OR"),
    )
    expect(html.indexOf("OR")).toBeLessThan(html.indexOf("Email address"))
    expect(html).not.toContain('name="password"')
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

  it("names Jesus Film One and the requesting application when provided", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain(
      "Log in to Jesus Film One to continue to Jesus Film Admin.",
    )
    expect(html).toContain("Welcome.")
    expect(html).toContain("have an account?")
    expect(html).toContain(
      'href="/signup?client_id=jfp_admin_local&amp;sig=signed"',
    )
  })

  it("renders sign-up copy and a log-in link in sign-up mode", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        flow="signup"
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain("Create your account.")
    expect(html).toContain(
      "Sign up to Jesus Film One to continue to Jesus Film Admin.",
    )
    expect(html).toContain("Sign up")
    expect(html).toContain("Already have an account?")
    expect(html).toContain(
      'href="/login?client_id=jfp_admin_local&amp;sig=signed"',
    )
    expect(html).toContain("By continuing, you agree to our")
    expect(html).toContain('href="https://www.jesusfilm.org/terms/"')
    expect(html).toContain('href="https://www.jesusfilm.org/privacy/"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it("falls back when the requesting application is unavailable", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        oauthQuery="client_id=unknown&sig=signed"
        requestingAppName={null}
      />,
    )

    expect(html).toContain("Log in to Jesus Film One to continue.")
  })

  it("links to Jesus Film legal pages below the auth panel", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain('aria-label="Legal"')
    expect(html).toContain('href="https://www.jesusfilm.org/terms/"')
    expect(html).toContain("Terms of Use")
    expect(html).toContain('href="https://www.jesusfilm.org/privacy/"')
    expect(html).toContain("Privacy Policy")
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
