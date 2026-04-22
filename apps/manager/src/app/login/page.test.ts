import { describe, expect, it, vi } from "vitest"

const { loginFormMock } = vi.hoisted(() => ({
  loginFormMock: vi.fn(() => null),
}))

vi.mock("./login-form", () => ({
  LoginForm: loginFormMock,
}))

import LoginPage from "./page"

describe("login page", () => {
  it("passes the expired flag from search params into the client form", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ expired: "1" }),
    })

    expect(element.type).toBe(loginFormMock)
    expect(element.props).toEqual({ expired: true })
  })
})
