import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
  type CryptoKey,
} from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const MOBILE_CLIENT_CLAIM = "https://jesusfilm.org/claims/client"
const ISSUER_ORIGIN = "https://auth.jesusfilm.org"

// Real typed fixtures (mocked-shape-vs-real-contract discipline): a real
// Ed25519 keypair signs real JWTs; the JWKS endpoint is a fetch stub
// serving the real public JWK. Only the network is mocked.
let privateKey: CryptoKey
let publicJwk: JWK

async function importMobileUserToken() {
  vi.resetModules()
  vi.stubEnv("CI", "true")
  vi.stubEnv("DATABASE_URL", "postgresql://example.test/db")
  vi.stubEnv("ADMIN_SESSION_SECRET", "admin-session-secret-at-least-32-chars")
  vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org/api/auth")
  vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "jfp_admin_local")
  return import("./mobile-user-token")
}

function stubJwksFetch(keys: JWK[] = [publicJwk]) {
  const fetchMock = vi.fn(async () => Response.json({ keys }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function mintJwt({
  claims = { [MOBILE_CLIENT_CLAIM]: "mobile" },
  subject = "auth-user-123",
  issuer = ISSUER_ORIGIN,
  audience = ISSUER_ORIGIN,
  expiresIn = "15m",
  key = privateKey,
  alg = "EdDSA",
}: {
  claims?: Record<string, unknown>
  subject?: string
  issuer?: string
  audience?: string
  expiresIn?: string
  key?: CryptoKey | Uint8Array
  alg?: string
} = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid: "mobile-test-key" })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key)
}

beforeEach(async () => {
  const pair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  })
  privateKey = pair.privateKey
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "mobile-test-key",
    alg: "EdDSA",
  }
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("resolveMobileUserPrincipalFromToken", () => {
  it("mints MOBILE_USER for a valid mobile-claim JWT", async () => {
    stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    await expect(
      resolveMobileUserPrincipalFromToken(`Bearer ${await mintJwt()}`),
    ).resolves.toEqual({
      id: "auth-user-123",
      role: "MOBILE_USER",
      rateLimitBucketKey: "auth-user-123",
    })
  })

  it("rejects a JWT minted from a non-mobile session (no client claim) — the discriminating case", async () => {
    stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    const anySessionJwt = await mintJwt({ claims: {} })
    await expect(
      resolveMobileUserPrincipalFromToken(`Bearer ${anySessionJwt}`),
    ).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=client_claim_missing"),
    )
  })

  it("fails closed with distinct reason codes for expired, wrong-issuer, and wrong-audience JWTs", async () => {
    stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    const cases: Array<[Promise<string>, string]> = [
      [mintJwt({ expiresIn: "-1m" }), "reason=expired"],
      [mintJwt({ issuer: "https://evil.example" }), "reason=iss_mismatch"],
      [mintJwt({ audience: "https://other.example" }), "reason=aud_mismatch"],
    ]
    for (const [jwtPromise, expected] of cases) {
      vi.mocked(console.warn).mockClear()
      await expect(
        resolveMobileUserPrincipalFromToken(`Bearer ${await jwtPromise}`),
      ).resolves.toBeNull()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(expected),
      )
    }
  })

  it("rejects a JWT signed by an unknown key", async () => {
    stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    const rogue = await generateKeyPair("EdDSA", { crv: "Ed25519" })
    const forged = await mintJwt({ key: rogue.privateKey })
    await expect(
      resolveMobileUserPrincipalFromToken(`Bearer ${forged}`),
    ).resolves.toBeNull()
  })

  it("rejects a symmetric (HS256) token — never resolves it against the JWKS", async () => {
    stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    const hs256 = await mintJwt({
      key: new TextEncoder().encode("a-32-byte-shared-secret-value-....."),
      alg: "HS256",
    })
    await expect(
      resolveMobileUserPrincipalFromToken(`Bearer ${hs256}`),
    ).resolves.toBeNull()
  })

  it("returns null for opaque bearers without any network fetch", async () => {
    const fetchMock = stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    await expect(
      resolveMobileUserPrincipalFromToken("Bearer jfp_at_opaque_web_token"),
    ).resolves.toBeNull()
    await expect(resolveMobileUserPrincipalFromToken(null)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails closed when the JWKS endpoint is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    await expect(
      resolveMobileUserPrincipalFromToken(`Bearer ${await mintJwt()}`),
    ).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=jwks_unavailable"),
    )
  })

  it("rejects a JWT missing a subject", async () => {
    stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    const noSub = await new SignJWT({ [MOBILE_CLIENT_CLAIM]: "mobile" })
      .setProtectedHeader({ alg: "EdDSA", kid: "mobile-test-key" })
      .setIssuer(ISSUER_ORIGIN)
      .setAudience(ISSUER_ORIGIN)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(privateKey)
    await expect(
      resolveMobileUserPrincipalFromToken(`Bearer ${noSub}`),
    ).resolves.toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=sub_missing"),
    )
  })

  it("caches the derived allowlist — repeat verifications do not refetch the allowlist", async () => {
    const fetchMock = stubJwksFetch()
    const { resolveMobileUserPrincipalFromToken } =
      await importMobileUserToken()

    await resolveMobileUserPrincipalFromToken(`Bearer ${await mintJwt()}`)
    const fetchesAfterFirst = fetchMock.mock.calls.length
    await resolveMobileUserPrincipalFromToken(`Bearer ${await mintJwt()}`)
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterFirst)
  })
})
