import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { studioAuthShellMock } = vi.hoisted(() => ({
  studioAuthShellMock: vi.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}))

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const { isLocalMockManagerLoginEnabledMock } = vi.hoisted(() => ({
  isLocalMockManagerLoginEnabledMock: vi.fn(() => false),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/features/shell/studio-auth-shell", () => ({
  StudioAuthShell: studioAuthShellMock,
}))

vi.mock("@/lib/oauth-client", () => ({
  getManagerBaseUrl: vi.fn(() => "http://localhost:3002"),
  getManagerOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.jesusfilm.org",
    clientId: "jfp_manager_local",
    managerBaseUrl: "http://localhost:3002",
  })),
}))

vi.mock("@/lib/mock-manager-login", () => ({
  isLocalMockManagerLoginEnabled: isLocalMockManagerLoginEnabledMock,
}))

import LoginPage from "./page"

describe("login page", () => {
  beforeEach(() => {
    redirectMock.mockClear()
    isLocalMockManagerLoginEnabledMock.mockReset()
    isLocalMockManagerLoginEnabledMock.mockReturnValue(false)
  })

  it("redirects directly into Manager OAuth login by default", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:http://localhost:3002/api/auth/login")
    expect(redirectMock).toHaveBeenCalledWith(
      "http://localhost:3002/api/auth/login",
    )
  })

  it("passes returnTo through to the OAuth login route", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          returnTo: "/dashboard/jobs/job-1?languageId=529",
        }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:http://localhost:3002/api/auth/login?returnTo=%2Fdashboard%2Fjobs%2Fjob-1%3FlanguageId%3D529",
    )
  })

  it("uses the local mock login route when mock Manager login is enabled", async () => {
    isLocalMockManagerLoginEnabledMock.mockReturnValue(true)

    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          returnTo: "/dashboard/smart-crop",
        }),
      }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:http://localhost:3002/api/auth/mock-login?returnTo=%2Fdashboard%2Fsmart-crop",
    )
  })

  it("redirects expired sessions directly into Manager OAuth login", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({ expired: "1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:http://localhost:3002/api/auth/login")
  })

  it("renders an error instead of looping when Auth callback fails", async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "forbidden" }),
    })
    expect(element.type).toBe(studioAuthShellMock)
    expect(element.props.title).toBe("Manager access unavailable")

    const card = element.props.children
    const [error, signOut] = React.Children.toArray(
      card.props.children,
    ) as React.ReactElement<{
      children: React.ReactNode
      href?: string
    }>[]

    expect(error.props.children).toBe(
      "This account is not approved for Manager access.",
    )
    expect(signOut.props.href).toBe("/api/auth/logout")
    expect(
      React.Children.toArray(signOut.props.children).some(
        (child) => child === "Sign out and try another account",
      ),
    ).toBe(true)
  })
})
