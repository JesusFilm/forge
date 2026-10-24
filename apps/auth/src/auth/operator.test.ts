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
        actorType: "HUMAN",
        membershipStatus: "SUSPENDED",
        nodeEnv: "production",
      }),
    ).toBe(false)
  })

  it("is disabled in production until the developer console is an OAuth client", () => {
    expect(
      canAccessAuthOperator({
        actorType: "HUMAN",
        membershipStatus: "ACTIVE",
        nodeEnv: "production",
      }),
    ).toBe(false)
  })

  it("allows active users outside production for local development", () => {
    expect(
      canAccessAuthOperator({
        actorType: "HUMAN",
        membershipStatus: "ACTIVE",
        nodeEnv: "development",
      }),
    ).toBe(true)
  })

  it("blocks agent users outside production", () => {
    expect(
      canAccessAuthOperator({
        actorType: "AGENT",
        membershipStatus: "ACTIVE",
        nodeEnv: "development",
      }),
    ).toBe(false)
  })
})
