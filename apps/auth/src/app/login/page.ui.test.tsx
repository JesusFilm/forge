import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { LoginPageClient } from "./login-page-client"
import { isOAuthAuthorizeRequest, toOAuthQuery } from "./login-page-data"

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
    expect(html).toContain("Email address")
    expect(html).not.toContain("Password")
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

  it("keeps the email and password fields visible after invalid credentials", () => {
    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        initialEmail="user@example.com"
        initialError="credentials"
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain('name="email"')
    expect(html).toContain('value="user@example.com"')
    expect(html).toContain("Password")
    expect(html).toContain('name="password"')
    expect(html).toContain('autoComplete="current-password"')
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
    expect(html.match(/disabled=""/g)).toHaveLength(3)
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
    expect(html).not.toContain("Password")
    expect(html).not.toContain('name="password"')
    expect(html).not.toContain('autoComplete="current-password"')
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

  it("does not carry login-only parameters into OAuth continuation links", () => {
    expect(
      toOAuthQuery({
        client_id: "jfp_admin_local",
        email: "user@example.com",
        error: "credentials",
        sig: "signed",
      }),
    ).toBe("client_id=jfp_admin_local&sig=signed")

    const html = renderToStaticMarkup(
      <LoginPageClient
        enabledProviders={[]}
        initialEmail="user@example.com"
        initialError="credentials"
        oauthQuery="client_id=jfp_admin_local&sig=signed"
        requestingAppName="Jesus Film Admin"
      />,
    )

    expect(html).toContain(
      'name="oauth_query" value="client_id=jfp_admin_local&amp;sig=signed"',
    )
    expect(html).toContain(
      'href="/signup?client_id=jfp_admin_local&amp;sig=signed"',
    )
    expect(html).not.toContain("email=user")
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

  it("renders the existing auth form for a trusted watch callback", () => {
    const callbackURL = "http://localhost:3000/watch/jesus/english"
    const html = renderToStaticMarkup(
      <LoginPageClient
        callbackURL={callbackURL}
        enabledProviders={["google"]}
        flow="login"
        oauthQuery=""
        requestingAppName="Jesus Film"
      />,
    )

    expect(html).toContain("Welcome.")
    expect(html).toContain(
      "Log in to Jesus Film One to continue to Jesus Film.",
    )
    expect(html).toContain("Continue with Google")
    expect(html).toContain("OR")
    expect(html).toContain('action="/api/auth/sign-in/email"')
    expect(html).toContain('name="callbackURL"')
    expect(html).toContain(`value="${callbackURL}"`)
    expect(html).not.toContain('name="name"')
    expect(html).not.toContain('name="password"')
    expect(html).not.toContain('autoComplete="new-password"')
    expect(html).toContain("Continue")
    expect(html).toContain(
      'href="/signup?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fwatch%2Fjesus%2Fenglish"',
    )
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
