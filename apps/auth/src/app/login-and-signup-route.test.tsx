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
