import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveDeviceClient = vi.fn()
const getSessionFromCtx = vi.fn()
const issueDeviceCode = vi.fn()
const approveDeviceCode = vi.fn()
const denyDeviceCode = vi.fn()
const pollDeviceCode = vi.fn()
const findPendingByUserCode = vi.fn()
const recordUserCodeAttempt = vi.fn(async (..._args: unknown[]) => undefined)

const canActorApproveDevice = vi.fn(async (..._args: unknown[]) => true)

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/device-actor-policy.service", () => ({
  canActorApproveDevice: (...args: unknown[]) => canActorApproveDevice(...args),
}))

vi.mock("@/services/device-client.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/device-client.service")
  >("@/services/device-client.service")
  return {
    ...actual,
    resolveDeviceClient: (...args: unknown[]) => resolveDeviceClient(...args),
  }
})

vi.mock("@/services/device-grant.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/device-grant.service")
  >("@/services/device-grant.service")
  return {
    ...actual,
    issueDeviceCode: (...a: unknown[]) => issueDeviceCode(...a),
    approveDeviceCode: (...a: unknown[]) => approveDeviceCode(...a),
    denyDeviceCode: (...a: unknown[]) => denyDeviceCode(...a),
    pollDeviceCode: (...a: unknown[]) => pollDeviceCode(...a),
    findPendingByUserCode: (...a: unknown[]) => findPendingByUserCode(...a),
    recordUserCodeAttempt: (...a: unknown[]) => recordUserCodeAttempt(...a),
  }
})

vi.mock("better-auth/api", async () => {
  const actual =
    await vi.importActual<typeof import("better-auth/api")>("better-auth/api")
  return {
    ...actual,
    getSessionFromCtx: (...args: unknown[]) => getSessionFromCtx(...args),
  }
})

const TV_CLIENT = {
  clientId: "jfp_tv_production",
  name: "Jesus Film TV (production)",
  scopes: ["openid", "web:watch-events:write"],
  redirectUris: ["https://auth.jesusfilm.org/device/callback"],
}

async function loadPlugin() {
  const { deviceGrantPlugin } = await import("./device-grant-plugin")
  return deviceGrantPlugin()
}

/** Minimal endpoint context; the plugin only reaches these fields. */
function ctx(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    query: {},
    // approve/deny declare requireHeaders, so the wrapper rejects a context
    // without them before the handler runs.
    headers: new Headers(),
    json: (value: unknown, init?: unknown) => ({ value, init }),
    context: {
      internalAdapter: { createVerificationValue: vi.fn(async () => ({})) },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  resolveDeviceClient.mockResolvedValue(TV_CLIENT)
  getSessionFromCtx.mockResolvedValue(null)
  canActorApproveDevice.mockResolvedValue(true)
  findPendingByUserCode.mockResolvedValue({
    id: "dc_1",
    clientId: "jfp_tv_production",
    scopes: TV_CLIENT.scopes,
    status: "PENDING",
    userId: null,
    expiresAt: new Date(Date.now() + 60_000),
    attemptCount: 0,
  })
})

/**
 * The session gate is the only thing standing between a live user code and a
 * stranger binding somebody else's TV to their own account. It had no coverage
 * at all until this file: deleting the check left the whole suite green.
 */
describe("approval requires an authenticated browser session", () => {
  for (const endpoint of ["deviceGrantApprove", "deviceGrantDeny"] as const) {
    it(`${endpoint} refuses an anonymous caller`, async () => {
      const plugin = await loadPlugin()
      getSessionFromCtx.mockResolvedValueOnce(null)

      await expect(
        plugin.endpoints[endpoint](
          ctx({ body: { user_code: "0194507302" } }) as never,
        ),
      ).rejects.toMatchObject({
        statusCode: 401,
        body: { error: "unauthorized" },
      })

      // The decisive part: it must not have touched the code.
      expect(approveDeviceCode).not.toHaveBeenCalled()
      expect(denyDeviceCode).not.toHaveBeenCalled()
    })
  }

  it("binds an approval to the session's own user, never the request body", async () => {
    // A caller cannot nominate whose account the TV is bound to.
    const plugin = await loadPlugin()
    getSessionFromCtx.mockResolvedValueOnce({
      user: { id: "user_real" },
      session: { id: "sess_real" },
    })
    approveDeviceCode.mockResolvedValueOnce(undefined)

    await plugin.endpoints.deviceGrantApprove(
      ctx({
        body: { user_code: "0194507302", userId: "user_attacker" },
      }) as never,
    )

    expect(approveDeviceCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user_real", sessionId: "sess_real" }),
    )
  })
})

describe("scope enforcement on issuance", () => {
  it("refuses a scope the client is not registered for", async () => {
    // The provider never sees this request, so this is the only scope gate.
    const plugin = await loadPlugin()

    await expect(
      plugin.endpoints.deviceGrantCode(
        ctx({
          body: {
            client_id: "jfp_tv_production",
            scope: "openid admin:access",
            code_challenge: "c".repeat(43),
            code_challenge_method: "S256",
          },
        }) as never,
      ),
    ).rejects.toMatchObject({ body: { error: "invalid_scope" } })

    expect(issueDeviceCode).not.toHaveBeenCalled()
  })

  it("issues the client's registered scopes when none are requested", async () => {
    const plugin = await loadPlugin()
    issueDeviceCode.mockResolvedValueOnce({
      deviceCode: "dc",
      userCode: "0194507302",
      expiresAt: new Date(),
      pollingIntervalMs: 5000,
    })

    await plugin.endpoints.deviceGrantCode(
      ctx({
        body: {
          client_id: "jfp_tv_production",
          code_challenge: "c".repeat(43),
          code_challenge_method: "S256",
        },
      }) as never,
    )

    expect(issueDeviceCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopes: TV_CLIENT.scopes }),
    )
  })

  it("refuses a client that does not carry the device grant", async () => {
    const plugin = await loadPlugin()
    resolveDeviceClient.mockResolvedValueOnce(null)

    await expect(
      plugin.endpoints.deviceGrantCode(
        ctx({
          body: {
            client_id: "jfp_web_production",
            code_challenge: "c".repeat(43),
            code_challenge_method: "S256",
          },
        }) as never,
      ),
    ).rejects.toMatchObject({ body: { error: "invalid_client" } })
  })
})

describe("kill switch", () => {
  it("answers 503 from the request path rather than throwing at boot", async () => {
    // Auth serves six live clients; a boot throw over an optional new grant
    // would take down login for all of them.
    vi.stubEnv("AUTH_DEVICE_GRANT_ENABLED", "false")
    const plugin = await loadPlugin()

    await expect(
      plugin.endpoints.deviceGrantCode(
        ctx({
          body: {
            client_id: "jfp_tv_production",
            code_challenge: "c".repeat(43),
            code_challenge_method: "S256",
          },
        }) as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      body: { error: "temporarily_unavailable" },
    })

    expect(resolveDeviceClient).not.toHaveBeenCalled()
  })

  it("serves normally when the switch is unset", async () => {
    const plugin = await loadPlugin()
    issueDeviceCode.mockResolvedValueOnce({
      deviceCode: "dc",
      userCode: "0194507302",
      expiresAt: new Date(),
      pollingIntervalMs: 5000,
    })

    await expect(
      plugin.endpoints.deviceGrantCode(
        ctx({
          body: {
            client_id: "jfp_tv_production",
            code_challenge: "c".repeat(43),
            code_challenge_method: "S256",
          },
        }) as never,
      ),
    ).resolves.toBeDefined()
  })
})

describe("token exchange failures never leak the cause", () => {
  it("returns invalid_grant and logs no error detail", async () => {
    const plugin = await loadPlugin()
    pollDeviceCode.mockResolvedValueOnce({
      id: "dc_1",
      clientId: "jfp_tv_production",
      scopes: ["openid"],
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
      userId: "user_1",
      sessionId: "sess_1",
    })

    const { deviceGrantPlugin } = await import("./device-grant-plugin")
    const failing = deviceGrantPlugin({
      exchangeAuthorizationCode: async () => {
        // A real failure message can embed fragments of the submitted code.
        throw new Error("code_verifier mismatch for AAAA-SECRET-BBBB")
      },
    })

    const logged: string[] = []
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line))
    })

    await expect(
      failing.endpoints.deviceGrantToken(
        ctx({
          body: {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: "dc",
            client_id: "jfp_tv_production",
            code_verifier: "v".repeat(43),
          },
        }) as never,
      ),
    ).rejects.toMatchObject({ body: { error: "invalid_grant" } })

    expect(logged.join("\n")).toContain("event=token_exchange_failed")
    expect(logged.join("\n")).not.toContain("SECRET")
    void plugin
  })
})

describe("actor policy on the approve endpoint", () => {
  it("refuses an approver the policy rejects, before touching the code", async () => {
    // /oauth2/authorize refuses an AGENT actor on a production client. The
    // device grant is the same decision on another surface; without this it
    // was a way around that gate.
    const plugin = await loadPlugin()
    getSessionFromCtx.mockResolvedValueOnce({
      user: { id: "agent_1" },
      session: { id: "sess_1" },
    })
    canActorApproveDevice.mockResolvedValueOnce(false)

    await expect(
      plugin.endpoints.deviceGrantApprove(
        ctx({ body: { user_code: "0194507302" } }) as never,
      ),
    ).rejects.toMatchObject({ body: { error: "access_denied" } })

    expect(approveDeviceCode).not.toHaveBeenCalled()
  })

  it("checks the policy against the client the code was issued for", async () => {
    const plugin = await loadPlugin()
    getSessionFromCtx.mockResolvedValueOnce({
      user: { id: "user_1" },
      session: { id: "sess_1" },
    })

    await plugin.endpoints.deviceGrantApprove(
      ctx({ body: { user_code: "0194507302" } }) as never,
    )

    expect(canActorApproveDevice).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      clientId: "jfp_tv_production",
    })
    expect(approveDeviceCode).toHaveBeenCalled()
  })
})
