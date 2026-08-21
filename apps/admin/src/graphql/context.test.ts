import { beforeEach, describe, expect, it, vi } from "vitest"

const resolvePrincipalFromRequest = vi.fn()
const isValidWorkflowBearer = vi.fn()
const isValidManagerBearer = vi.fn()
const isValidVideoMapperBearer = vi.fn()
const isValidConsumerBearer = vi.fn()
const resolveWebUserPrincipalFromToken = vi.fn()
const resolveMobileUserPrincipalFromToken = vi.fn()

vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest,
}))

vi.mock("@/auth/workflow-bearer", () => ({
  isValidWorkflowBearer,
}))

vi.mock("@/auth/manager-bearer", () => ({
  isValidManagerBearer,
}))

vi.mock("@/auth/video-mapper-bearer", () => ({
  isValidVideoMapperBearer,
}))

vi.mock("@/auth/consumer-bearer", () => ({
  isValidConsumerBearer,
}))

vi.mock("@/auth/web-user-token", () => ({
  resolveWebUserPrincipalFromToken,
}))

vi.mock("@/auth/mobile-user-token", () => ({
  resolveMobileUserPrincipalFromToken,
}))

describe("createContext", () => {
  beforeEach(() => {
    resolvePrincipalFromRequest.mockReset()
    isValidWorkflowBearer.mockReset()
    isValidManagerBearer.mockReset()
    isValidVideoMapperBearer.mockReset()
    isValidConsumerBearer.mockReset()
    resolveWebUserPrincipalFromToken.mockReset()
    resolveMobileUserPrincipalFromToken.mockReset()
    isValidWorkflowBearer.mockReturnValue(false)
    isValidManagerBearer.mockReturnValue(false)
    isValidVideoMapperBearer.mockReturnValue(false)
    isValidConsumerBearer.mockReturnValue({ valid: false, bucketKey: null })
    resolveWebUserPrincipalFromToken.mockResolvedValue(null)
    resolveMobileUserPrincipalFromToken.mockResolvedValue(null)
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

  // ---------------------------------------------------------------------------
  // Plan 003 (U1) — CONSUMER_BEARER resolution
  // ---------------------------------------------------------------------------

  it("mints CONSUMER_BEARER when no session, workflow-bearer invalid, consumer-bearer valid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidConsumerBearer.mockReturnValue({
      valid: true,
      bucketKey: "consumer-key-aaa",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer consumer-key-aaa" },
      }),
    })

    expect(ctx.user).toEqual({
      id: null,
      role: "CONSUMER_BEARER",
      rateLimitBucketKey: "consumer-key-aaa",
      fleet: false,
    })
    expect(isValidConsumerBearer).toHaveBeenCalledWith(
      "Bearer consumer-key-aaa",
    )
  })

  it("threads the fleet flag onto the principal for a fleet key (per-IP bucket seam)", async () => {
    // Cross-seam guard (KTD1): the fleet discriminant identifyForRateLimit reads
    // for consumer:<key>:<ip> comes straight from isValidConsumerBearer via
    // createContext — the same field search-bearer reads for source=fleet, so a
    // future edit that drops it here decouples the bucket from the log signal.
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidConsumerBearer.mockReturnValue({
      valid: true,
      bucketKey: "fleet-key-zzz",
      fleet: true,
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer fleet-key-zzz" },
      }),
    })

    expect(ctx.user).toEqual({
      id: null,
      role: "CONSUMER_BEARER",
      rateLimitBucketKey: "fleet-key-zzz",
      fleet: true,
    })
  })

  it("mints MANAGER_BACKEND when no session and manager bearer is valid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidManagerBearer.mockReturnValue(true)
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer manager-key" },
      }),
    })

    expect(ctx.user).toEqual({ id: null, role: "MANAGER_BACKEND" })
    expect(isValidManagerBearer).toHaveBeenCalledWith("Bearer manager-key")
    expect(isValidConsumerBearer).not.toHaveBeenCalled()
  })

  it("mints VIDEO_MAPPER when no session and mapper bearer is valid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidManagerBearer.mockReturnValue(false)
    isValidVideoMapperBearer.mockReturnValue(true)
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer mapper-key" },
      }),
    })

    expect(ctx.user).toEqual({ id: null, role: "VIDEO_MAPPER" })
    expect(isValidVideoMapperBearer).toHaveBeenCalledWith("Bearer mapper-key")
    expect(isValidConsumerBearer).not.toHaveBeenCalled()
  })

  it("mints MOBILE_USER before the web-user branch, without an introspection call", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    resolveMobileUserPrincipalFromToken.mockResolvedValueOnce({
      id: "auth-user-456",
      role: "MOBILE_USER",
      rateLimitBucketKey: "auth-user-456",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer mobile-user-jwt" },
      }),
    })

    expect(ctx.user).toEqual({
      id: "auth-user-456",
      role: "MOBILE_USER",
      rateLimitBucketKey: "auth-user-456",
    })
    // Chain position is load-bearing: a mobile JWT must never spend the
    // web branch's network introspection round trip.
    expect(resolveWebUserPrincipalFromToken).not.toHaveBeenCalled()
  })

  it("falls through to the web-user branch when the bearer is not a mobile JWT", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    resolveMobileUserPrincipalFromToken.mockResolvedValueOnce(null)
    resolveWebUserPrincipalFromToken.mockResolvedValueOnce({
      id: "auth-user-123",
      role: "WEB_USER",
      rateLimitBucketKey: "auth-user-123",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer jfp_at_opaque" },
      }),
    })

    expect(ctx.user).toEqual({
      id: "auth-user-123",
      role: "WEB_USER",
      rateLimitBucketKey: "auth-user-123",
    })
  })

  it("retains delegated playlist scope metadata on the GraphQL context principal", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    resolveMobileUserPrincipalFromToken.mockResolvedValueOnce(null)
    resolveWebUserPrincipalFromToken.mockResolvedValueOnce({
      id: "auth-user-123",
      role: "WEB_USER",
      rateLimitBucketKey: "auth-user-123",
      delegated: {
        active: true,
        issuer: "https://auth.jesusfilm.org/api/auth",
        audience: ["http://localhost:3003/api/graphql"],
        clientId: "jfp_web_local",
        environment: "local",
        scopes: ["openid", "playlist:read"],
      },
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer playlist-only-token" },
      }),
    })

    expect(ctx.user?.delegated?.scopes).toEqual(["openid", "playlist:read"])
    expect(resolveWebUserPrincipalFromToken).toHaveBeenCalledWith(
      "Bearer playlist-only-token",
    )
  })

  it("mints WEB_USER before falling through to consumer-bearer", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidManagerBearer.mockReturnValue(false)
    isValidVideoMapperBearer.mockReturnValue(false)
    resolveWebUserPrincipalFromToken.mockResolvedValueOnce({
      id: "auth-user-123",
      role: "WEB_USER",
      rateLimitBucketKey: "auth-user-123",
    })
    isValidConsumerBearer.mockReturnValue({
      valid: true,
      bucketKey: "consumer-key-aaa",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer user-token" },
      }),
    })

    expect(ctx.user).toEqual({
      id: "auth-user-123",
      role: "WEB_USER",
      rateLimitBucketKey: "auth-user-123",
    })
    expect(resolveWebUserPrincipalFromToken).toHaveBeenCalledWith(
      "Bearer user-token",
    )
    expect(isValidConsumerBearer).not.toHaveBeenCalled()
  })

  it("session principal wins over consumer-bearer (no accidental downgrade)", async () => {
    // Editor with a session cookie who ALSO forwards a consumer-app
    // bearer keeps their editorial role. The bearer is not consulted
    // because the session resolved first.
    resolvePrincipalFromRequest.mockResolvedValueOnce({
      id: "alice",
      role: "EDITOR",
    })
    isValidConsumerBearer.mockReturnValue({
      valid: true,
      bucketKey: "consumer-key-aaa",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer consumer-key-aaa" },
      }),
    })

    expect(ctx.user).toEqual({ id: "alice", role: "EDITOR" })
  })

  it("workflow-bearer wins over consumer-bearer when both validators would accept", async () => {
    // If the same header somehow satisfies both validators (e.g. a
    // deployment that accidentally placed the same key in both CSVs),
    // the workflow path takes precedence — preserves its narrow
    // permission allowlist semantics rather than silently demoting
    // workflow callers to the permissionless consumer bucket.
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(true)
    isValidConsumerBearer.mockReturnValue({
      valid: true,
      bucketKey: "shared-key",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer shared-key" },
      }),
    })

    expect(ctx.user).toEqual({ id: null, role: "WORKFLOW_TRIGGER" })
    // consumer-bearer never consulted because workflow-bearer matched
    // first.
    expect(isValidConsumerBearer).not.toHaveBeenCalled()
  })

  it("returns PUBLIC when no session and neither bearer validator accepts", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidVideoMapperBearer.mockReturnValue(false)
    isValidConsumerBearer.mockReturnValue({ valid: false, bucketKey: null })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer mystery-key" },
      }),
    })

    expect(ctx.user).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Log scrubbing — neither the raw header nor the matched key may
  // ever appear in console output from createContext.
  // ---------------------------------------------------------------------------

  it("does NOT log the Authorization header or bearer key on any resolution path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    try {
      const { createContext } = await import("@/graphql/context")

      // Walk every principal-resolution branch.
      resolvePrincipalFromRequest.mockResolvedValueOnce(null)
      isValidWorkflowBearer.mockReturnValueOnce(true)
      await createContext({
        request: new Request("http://localhost/api/graphql", {
          headers: { authorization: "Bearer workflow-secret-aaa" },
        }),
      })
      resolvePrincipalFromRequest.mockResolvedValueOnce(null)
      isValidWorkflowBearer.mockReturnValueOnce(false)
      isValidManagerBearer.mockReturnValueOnce(false)
      isValidConsumerBearer.mockReturnValueOnce({
        valid: true,
        bucketKey: "consumer-secret-bbb",
      })
      await createContext({
        request: new Request("http://localhost/api/graphql", {
          headers: { authorization: "Bearer consumer-secret-bbb" },
        }),
      })
      resolvePrincipalFromRequest.mockResolvedValueOnce(null)
      isValidWorkflowBearer.mockReturnValueOnce(false)
      isValidManagerBearer.mockReturnValueOnce(true)
      await createContext({
        request: new Request("http://localhost/api/graphql", {
          headers: { authorization: "Bearer manager-secret-ddd" },
        }),
      })
      resolvePrincipalFromRequest.mockResolvedValueOnce(null)
      isValidWorkflowBearer.mockReturnValueOnce(false)
      isValidManagerBearer.mockReturnValueOnce(false)
      isValidVideoMapperBearer.mockReturnValueOnce(true)
      await createContext({
        request: new Request("http://localhost/api/graphql", {
          headers: { authorization: "Bearer mapper-secret-eee" },
        }),
      })
      resolvePrincipalFromRequest.mockResolvedValueOnce(null)
      isValidWorkflowBearer.mockReturnValueOnce(false)
      isValidManagerBearer.mockReturnValueOnce(false)
      isValidVideoMapperBearer.mockReturnValueOnce(false)
      resolveWebUserPrincipalFromToken.mockResolvedValueOnce({
        id: "web-secret-fff",
        role: "WEB_USER",
      })
      await createContext({
        request: new Request("http://localhost/api/graphql", {
          headers: { authorization: "Bearer web-secret-fff" },
        }),
      })
      resolvePrincipalFromRequest.mockResolvedValueOnce(null)
      isValidWorkflowBearer.mockReturnValueOnce(false)
      isValidManagerBearer.mockReturnValueOnce(false)
      isValidVideoMapperBearer.mockReturnValueOnce(false)
      isValidConsumerBearer.mockReturnValueOnce({
        valid: false,
        bucketKey: null,
      })
      await createContext({
        request: new Request("http://localhost/api/graphql", {
          headers: { authorization: "Bearer wrong-key-ccc" },
        }),
      })

      const combined = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...debugSpy.mock.calls,
      ])
      expect(combined).not.toContain("workflow-secret-aaa")
      expect(combined).not.toContain("consumer-secret-bbb")
      expect(combined).not.toContain("wrong-key-ccc")
      expect(combined).not.toContain("manager-secret-ddd")
      expect(combined).not.toContain("mapper-secret-eee")
      expect(combined).not.toContain("web-secret-fff")
      expect(combined).not.toContain("Bearer ")
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
      infoSpy.mockRestore()
      debugSpy.mockRestore()
    }
  })
})
