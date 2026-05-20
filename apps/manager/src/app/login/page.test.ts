import type React from "react"
import { describe, expect, it, vi } from "vitest"

const { loginFormMock } = vi.hoisted(() => ({
  loginFormMock: vi.fn(() => null),
}))

const { studioAuthShellMock } = vi.hoisted(() => ({
  studioAuthShellMock: vi.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}))

vi.mock("./login-form", () => ({
  LoginForm: loginFormMock,
}))

vi.mock("@/features/shell/studio-auth-shell", () => ({
  StudioAuthShell: studioAuthShellMock,
}))

import LoginPage from "./page"

describe("login page", () => {
  it("passes the expired flag from search params into the client form", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ expired: "1" }),
    })

    expect(element.type).toBe(studioAuthShellMock)
    const suspense = element.props.children
    expect(suspense.props.children.type).toBe(loginFormMock)
    expect(suspense.props.children.props).toEqual({
      error: undefined,
      expired: true,
    })
  })
})
