import { afterEach, describe, expect, it, vi } from "vitest"

const { loginPageClientMock, redirectMock } = vi.hoisted(() => ({
  loginPageClientMock: vi.fn(() => null),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

vi.mock("@/config/env", () => ({
  env: {},
  getAuthBaseUrl: () => "http://localhost:3004",
  getAuthTrustedOrigins: () => [
    "http://localhost:3004",
    "http://localhost:3000",
  ],
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/app/login/login-page-client", () => ({
  LoginPageClient: loginPageClientMock,
}))

afterEach(() => {
  loginPageClientMock.mockClear()
  redirectMock.mockClear()
})

describe("Auth callback login and signup routes", () => {
  it("forces trusted callbackURL login entries to login mode even when mode=signup is supplied", async () => {
    const LoginPage = (await import("@/app/login/page")).default

    const element = (await LoginPage({
      searchParams: Promise.resolve({
        callbackURL: "http://localhost:3000/watch/jesus/english",
        mode: "signup",
      }),
    })) as { props: Record<string, unknown> }

    expect(element.props).toMatchObject({
      callbackURL: "http://localhost:3000/watch/jesus/english",
      flow: "login",
    })
    expect(loginPageClientMock).not.toHaveBeenCalled()
  })

  it("keeps the device approval hop on the login surface instead of bouncing it", async () => {
    // `/device` cannot ride callbackURL (web-callback.ts filters auth's own
    // origin), so its signed-out hop arrives as `?user_code=…`. Without the
    // device branch this request is bounced to the marketing site and the TV
    // hand-off dead-ends.
    const LoginPage = (await import("@/app/login/page")).default

    const element = (await LoginPage({
      searchParams: Promise.resolve({
        prompt: "login",
        user_code: "0194507302",
      }),
    })) as { props: Record<string, unknown> }

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element.props.callbackURL).toBeUndefined()
    const oauthQuery = new URLSearchParams(String(element.props.oauthQuery))
    expect(oauthQuery.get("user_code")).toBe("0194507302")
    expect(oauthQuery.get("prompt")).toBe("login")
  })

  it("still bounces a login entry that carries no code and no callback", async () => {
    const LoginPage = (await import("@/app/login/page")).default

    await expect(
      LoginPage({ searchParams: Promise.resolve({ prompt: "login" }) }),
    ).rejects.toThrow("redirect:https://www.jesusfilm.org")
  })

  it("does not open the login surface for an unusable user code", async () => {
    const LoginPage = (await import("@/app/login/page")).default

    await expect(
      LoginPage({ searchParams: Promise.resolve({ user_code: "---" }) }),
    ).rejects.toThrow("redirect:https://www.jesusfilm.org")
  })

  it("leaves the trusted watch callback entry carrying no oauth query", async () => {
    const LoginPage = (await import("@/app/login/page")).default

    const element = (await LoginPage({
      searchParams: Promise.resolve({
        callbackURL: "http://localhost:3000/watch/jesus/english",
        user_code: "0194507302",
      }),
    })) as { props: Record<string, unknown> }

    expect(element.props).toMatchObject({
      callbackURL: "http://localhost:3000/watch/jesus/english",
      oauthQuery: "",
    })
  })

  it("redirects direct signup callback entries away from public signup", async () => {
    const SignupPage = (await import("@/app/signup/page")).default

    await expect(
      SignupPage({
        searchParams: Promise.resolve({
          callbackURL: "http://localhost:3000/watch/jesus/english",
        }),
      }),
    ).rejects.toThrow("redirect:https://www.jesusfilm.org")
    expect(redirectMock).toHaveBeenCalledWith("https://www.jesusfilm.org")
    expect(loginPageClientMock).not.toHaveBeenCalled()
  })
})
