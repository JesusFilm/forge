import { beforeEach, describe, expect, it, vi } from "vitest"

const resolvePrincipalFromRequest = vi.fn()

vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest,
}))

describe("createContext", () => {
  beforeEach(() => {
    resolvePrincipalFromRequest.mockReset()
  })

  it("returns PUBLIC when no session resolves", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql"),
    })

    expect(ctx.user).toBeNull()
  })

  it("maps a resolved session principal into context", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce({
      id: "user-123",
      role: "EDITOR",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql"),
    })

    expect(ctx.user).toEqual({ id: "user-123", role: "EDITOR" })
    expect(ctx.prisma).toBeDefined()
    expect(ctx.loaders.experienceById).toBeDefined()
  })
})
