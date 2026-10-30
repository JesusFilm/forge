import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  jwks: { findMany: vi.fn() },
  oauthClient: { findUnique: vi.fn() },
}))

vi.mock("@/db/client", () => ({
  prisma: { $transaction: vi.fn((callback) => callback(tx)) },
}))
vi.mock("@/config/env", () => ({
  getAuthBaseUrl: () => "http://localhost:3004",
  isChangelogProductionEnabled: () => false,
}))
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>()
  return {
    ...actual,
    createLocalJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
  }
})

import { errors, jwtVerify } from "jose"

import { GET } from "./route"

const request = () =>
  GET(
    new Request(
      "http://localhost:3004/api/changelog/current-permission?clientId=jfp_changelog_local",
      { headers: { authorization: "Bearer issued-token" } },
    ),
  )

describe("current permission failure classification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.jwks.findMany.mockResolvedValue([
      { id: "key-1", publicKey: '{"kty":"OKP"}', alg: "EdDSA" },
    ])
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: "user-1",
        sid: "session-1",
        client_id: "jfp_changelog_local",
        azp: "jfp_changelog_local",
        scope: "changelog:read",
        "https://jesusfilm.org/claims/app": "changelog",
        "https://jesusfilm.org/claims/environment": "local",
      },
      protectedHeader: { alg: "EdDSA" },
    })
  })

  it("returns 503 when the OAuth client lookup fails", async () => {
    tx.oauthClient.findUnique.mockRejectedValue(new Error("database secret"))

    const response = await request()

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ error: "permission-unavailable" })
  })

  it("returns 503 when a stored signing key is malformed", async () => {
    tx.jwks.findMany.mockResolvedValue([
      { id: "key-1", publicKey: "not JSON", alg: "EdDSA" },
    ])

    const response = await request()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "permission-unavailable" })
  })

  it("returns 503 when a stored signing key cannot be imported", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new errors.JWKSInvalid("bad key"))

    const response = await request()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "permission-unavailable" })
  })

  it("returns 401 for an invalid token", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new errors.JWTInvalid("bad token"))

    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "invalid-credential" })
  })

  it("returns 401 for a disabled OAuth client", async () => {
    tx.oauthClient.findUnique.mockResolvedValue({ disabled: true })

    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "invalid-credential" })
  })
})
