import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  canRedeemAgentLoginHandle,
  isAgentLoginHandle,
  mintAgentLoginHandle,
  AGENT_LOGIN_HANDLE_DOMAIN,
  AgentLoginError,
  redeemAgentLoginHandle,
} from "./agent-login.service"

const now = new Date("2026-06-11T12:00:00.000Z")
const expiresAt = new Date("2026-06-11T12:30:00.000Z")

function environment(overrides: Record<string, unknown> = {}) {
  return {
    id: "env_1",
    appId: "app_1",
    clientId: "jfp_admin_local",
    kind: "LOCAL",
    status: "APPROVED",
    defaultScopes: ["openid", "profile:read", "email:read", "admin:access"],
    redirectUris: ["http://localhost:3003/api/auth/callback"],
    app: { id: "app_1", status: "ACTIVE" },
    ...overrides,
  }
}

function createPrismaMock() {
  const tx = {
    appGrant: {
      create: vi.fn(async () => ({ id: "grant_1" })),
    },
    appGrantScope: {
      create: vi.fn(async () => ({})),
    },
    scope: {
      findMany: vi.fn(async () => [
        { id: "scope_openid", key: "openid" },
        { id: "scope_email", key: "email:read" },
      ]),
    },
    user: {
      create: vi.fn(async () => ({ id: "agent_user_1" })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: "agent_user_1",
        name: "Agent",
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  }

  return {
    $transaction: vi.fn(async (callback) => callback(tx)),
    appEnvironment: {
      findUnique: vi.fn(),
    },
    authAuditEvent: {
      create: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(),
    },
    tx,
  }
}

describe("Agent login service", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("recognizes the reserved email-like handle domain", () => {
    expect(
      isAgentLoginHandle(`agent+admin.abc@${AGENT_LOGIN_HANDLE_DOMAIN}`),
    ).toBe(true)
    expect(isAgentLoginHandle("user@example.com")).toBe(false)
  })

  it("mints a short-lived expiring agent user with an app grant", async () => {
    const prisma = createPrismaMock()
    prisma.appEnvironment.findUnique.mockResolvedValueOnce(environment())

    const result = await mintAgentLoginHandle(prisma as never, {
      clientId: "jfp_admin_local",
      redirectUri: "http://localhost:3003/api/auth/callback",
      requestedScopes: ["openid", "email:read"],
      now,
    })

    expect(result.handle).toContain(`@${AGENT_LOGIN_HANDLE_DOMAIN}`)
    expect(result.expiresAt).toEqual(expiresAt)
    expect(prisma.tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "AGENT",
        email: result.handle,
        emailVerified: true,
        expiresAt,
        membershipStatus: "ACTIVE",
      }),
      select: { id: true },
    })
    expect(prisma.tx.appGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appId: "app_1",
        environmentId: "env_1",
        reason: "Agent login handle mint",
        status: "APPROVED",
        subjectType: "USER",
        userId: "agent_user_1",
      }),
      select: { id: true },
    })
    expect(prisma.authAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ handle: "[redacted]" }),
      }),
    })
  })

  it("rejects production clients", async () => {
    const prisma = createPrismaMock()
    prisma.appEnvironment.findUnique.mockResolvedValueOnce(
      environment({
        kind: "PRODUCTION",
        defaultScopes: ["openid", "email:read"],
        redirectUris: ["https://admin.jesusfilm.org/api/auth/callback"],
      }),
    )

    await expect(
      mintAgentLoginHandle(prisma as never, {
        clientId: "jfp_admin_production",
        redirectUri: "https://admin.jesusfilm.org/api/auth/callback",
        now,
      }),
    ).rejects.toMatchObject({
      code: "unsupported_environment",
    } satisfies Partial<AgentLoginError>)
  })

  it("rejects requested scopes outside the environment defaults", async () => {
    const prisma = createPrismaMock()
    prisma.appEnvironment.findUnique.mockResolvedValueOnce(environment())

    await expect(
      mintAgentLoginHandle(prisma as never, {
        clientId: "jfp_admin_local",
        redirectUri: "http://localhost:3003/api/auth/callback",
        requestedScopes: ["manager:access"],
        now,
      }),
    ).rejects.toMatchObject({
      code: "invalid_scope",
    } satisfies Partial<AgentLoginError>)
  })

  it("validates active expiring agent users without consuming them", async () => {
    const handle = `agent+admin.abc@${AGENT_LOGIN_HANDLE_DOMAIN}`
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValueOnce({
      actorType: "AGENT",
      expiresAt,
    })

    await expect(
      canRedeemAgentLoginHandle(prisma as never, {
        handle,
        oauthQuery:
          "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
        now,
      }),
    ).resolves.toBe(true)
    expect(prisma.tx.user.updateMany).not.toHaveBeenCalled()
  })

  it("redeems a handle once by expiring the agent user", async () => {
    const handle = `agent+admin.abc@${AGENT_LOGIN_HANDLE_DOMAIN}`
    const prisma = createPrismaMock()

    const redeemed = await redeemAgentLoginHandle(prisma as never, {
      handle,
      oauthQuery:
        "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
      now,
    })

    expect(redeemed).toMatchObject({
      email: handle,
      userId: "agent_user_1",
      callbackURL:
        "/api/auth/oauth2/authorize?client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
    })
    expect(prisma.tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        actorType: "AGENT",
        email: handle,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    })
  })

  it("rejects a second redemption when the atomic claim fails", async () => {
    const handle = `agent+admin.abc@${AGENT_LOGIN_HANDLE_DOMAIN}`
    const prisma = createPrismaMock()
    prisma.tx.user.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      redeemAgentLoginHandle(prisma as never, {
        handle,
        oauthQuery:
          "client_id=jfp_admin_local&redirect_uri=http%3A%2F%2Flocalhost%3A3003%2Fapi%2Fauth%2Fcallback",
        now,
      }),
    ).rejects.toMatchObject({
      code: "invalid_handle",
    } satisfies Partial<AgentLoginError>)
  })

  it("rejects minting when scope seed data is incomplete", async () => {
    const prisma = createPrismaMock()
    prisma.appEnvironment.findUnique.mockResolvedValueOnce(environment())
    prisma.tx.scope.findMany.mockResolvedValueOnce([
      { id: "scope_openid", key: "openid" },
    ])

    await expect(
      mintAgentLoginHandle(prisma as never, {
        clientId: "jfp_admin_local",
        redirectUri: "http://localhost:3003/api/auth/callback",
        requestedScopes: ["openid", "email:read"],
        now,
      }),
    ).rejects.toMatchObject({
      code: "invalid_scope",
    } satisfies Partial<AgentLoginError>)
  })
})
