import { beforeEach, describe, expect, it, vi } from "vitest"

const resolvePrincipalFromRequest = vi.fn()
const isValidWorkflowBearer = vi.fn()

vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest,
}))

vi.mock("@/auth/workflow-bearer", () => ({
  isValidWorkflowBearer,
}))

describe("createContext", () => {
  beforeEach(() => {
    resolvePrincipalFromRequest.mockReset()
    isValidWorkflowBearer.mockReset()
    isValidWorkflowBearer.mockReturnValue(false)
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
    expect(ctx.request).toBeDefined()
    expect(ctx.prisma).toBeDefined()
    expect(ctx.loaders.experienceById).toBeDefined()
  })

  it("mints WORKFLOW_TRIGGER when no session and bearer header is valid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(true)
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer test-key" },
      }),
    })

    expect(ctx.user).toEqual({ id: null, role: "WORKFLOW_TRIGGER" })
    expect(isValidWorkflowBearer).toHaveBeenCalledWith("Bearer test-key")
  })

  it("does NOT downgrade an existing session principal when bearer is also present", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce({
      id: "admin-1",
      role: "ADMIN",
    })
    isValidWorkflowBearer.mockReturnValue(true)
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer test-key" },
      }),
    })

    expect(ctx.user).toEqual({ id: "admin-1", role: "ADMIN" })
  })

  it("returns PUBLIC when no session and bearer is invalid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer wrong" },
      }),
    })

    expect(ctx.user).toBeNull()
  })
})
