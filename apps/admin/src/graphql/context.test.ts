import { beforeEach, describe, expect, it, vi } from "vitest"

const resolvePrincipalFromRequest = vi.fn()
const isValidWorkflowBearer = vi.fn()
const isValidConsumerBearer = vi.fn()
const isValidParityBearer = vi.fn()

vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest,
}))

vi.mock("@/auth/workflow-bearer", () => ({
  isValidWorkflowBearer,
}))

vi.mock("@/auth/consumer-bearer", () => ({
  isValidConsumerBearer,
}))

vi.mock("@/auth/parity-bearer", () => ({
  isValidParityBearer,
}))

describe("createContext", () => {
  beforeEach(() => {
    resolvePrincipalFromRequest.mockReset()
    isValidWorkflowBearer.mockReset()
    isValidConsumerBearer.mockReset()
    isValidParityBearer.mockReset()
    isValidWorkflowBearer.mockReturnValue(false)
    isValidConsumerBearer.mockReturnValue({ valid: false, bucketKey: null })
    isValidParityBearer.mockReturnValue({ valid: false, bucketKey: null })
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
    })
    expect(isValidConsumerBearer).toHaveBeenCalledWith(
      "Bearer consumer-key-aaa",
    )
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
  // PR-C — PARITY_BEARER resolution + precedence (workflow → parity → consumer)
  // ---------------------------------------------------------------------------

  it("mints PARITY_BEARER when no session, workflow invalid, parity valid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidParityBearer.mockReturnValue({
      valid: true,
      bucketKey: "parity-key-aaa",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer parity-key-aaa" },
      }),
    })

    expect(ctx.user).toEqual({
      id: null,
      role: "PARITY_BEARER",
      rateLimitBucketKey: "parity-key-aaa",
    })
    expect(isValidParityBearer).toHaveBeenCalledWith("Bearer parity-key-aaa")
  })

  it("workflow-bearer wins over parity-bearer when both validators accept (precedence)", async () => {
    // P1-2 disjointness check at boot should make this state impossible
    // in practice — but if both validators somehow accept, workflow's
    // narrower allowlist wins so the bearer doesn't get downgraded into
    // a wider permission surface.
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(true)
    isValidParityBearer.mockReturnValue({
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
    expect(isValidParityBearer).not.toHaveBeenCalled()
  })

  it("parity-bearer wins over consumer-bearer when both validators accept", async () => {
    // Same dual-CSV-collision defense, parity side. Parity sees
    // templates (R9 carve-out); consumer does not. If a key were in
    // both CSVs, minting CONSUMER_BEARER would silently hide templates
    // from the harness — exactly the failure mode the precedence
    // exists to prevent.
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidParityBearer.mockReturnValue({
      valid: true,
      bucketKey: "shared-key",
    })
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

    expect(ctx.user).toEqual({
      id: null,
      role: "PARITY_BEARER",
      rateLimitBucketKey: "shared-key",
    })
    expect(isValidConsumerBearer).not.toHaveBeenCalled()
  })

  it("falls through to consumer-bearer when parity-bearer invalid", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce(null)
    isValidWorkflowBearer.mockReturnValue(false)
    isValidParityBearer.mockReturnValue({ valid: false, bucketKey: null })
    isValidConsumerBearer.mockReturnValue({
      valid: true,
      bucketKey: "consumer-key-bbb",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer consumer-key-bbb" },
      }),
    })

    expect(ctx.user).toEqual({
      id: null,
      role: "CONSUMER_BEARER",
      rateLimitBucketKey: "consumer-key-bbb",
    })
  })

  it("session principal wins over parity-bearer (no accidental downgrade)", async () => {
    resolvePrincipalFromRequest.mockResolvedValueOnce({
      id: "admin-1",
      role: "ADMIN",
    })
    isValidParityBearer.mockReturnValue({
      valid: true,
      bucketKey: "parity-key-aaa",
    })
    const { createContext } = await import("@/graphql/context")

    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { authorization: "Bearer parity-key-aaa" },
      }),
    })

    expect(ctx.user).toEqual({ id: "admin-1", role: "ADMIN" })
    expect(isValidParityBearer).not.toHaveBeenCalled()
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
