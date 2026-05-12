import { describe, expect, it, vi } from "vitest"

vi.mock("@/auth/config", () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock("@/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

import { canAccessAuthOperator } from "./operator"

describe("Auth operator access", () => {
  it("requires active membership", () => {
    expect(
      canAccessAuthOperator({
        email: "ops@jesusfilm.org",
        membershipStatus: "SUSPENDED",
        operatorEmails: ["ops@jesusfilm.org"],
        nodeEnv: "production",
      }),
    ).toBe(false)
  })

  it("requires an explicit allowlist in production", () => {
    expect(
      canAccessAuthOperator({
        email: "ops@jesusfilm.org",
        membershipStatus: "ACTIVE",
        operatorEmails: [],
        nodeEnv: "production",
      }),
    ).toBe(false)
  })

  it("matches configured operators case-insensitively", () => {
    expect(
      canAccessAuthOperator({
        email: "Ops@JesusFilm.org",
        membershipStatus: "ACTIVE",
        operatorEmails: ["ops@jesusfilm.org"],
        nodeEnv: "production",
      }),
    ).toBe(true)
  })
})
