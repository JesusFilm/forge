import { describe, expect, it, vi } from "vitest"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

import HomePage from "./page"

describe("home page UI", () => {
  it("redirects to the dashboard", async () => {
    await HomePage()

    expect(redirectMock).toHaveBeenCalledWith("/dashboard")
  })
})
