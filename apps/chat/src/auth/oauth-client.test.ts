// @vitest-environment node
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatAuthError } from "./errors"
import {
  __resetChatOAuthCaches,
  buildChatAuthorizeUrl,
  type ChatOAuthConfig,
  verifyChatIdToken,
} from "./oauth-client"

const config: ChatOAuthConfig = {
  issuerUrl: "https://auth.example.com/api/auth",
  clientId: "chat-client",
  chatBaseUrl: "https://chat.example.com",
}

// ── test key material ────────────────────────────────────────────────────────

type SigningKey = {
  privateKey: CryptoKey
  jwk: JWK
}

async function makeKey(
  alg: string,
  kid: string,
  { includeAlg = false }: { includeAlg?: boolean } = {},
): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(alg, {
    extractable: true,
  })
  const jwk = await exportJWK(publicKey)
  jwk.kid = kid
  if (includeAlg) jwk.alg = alg
  return { privateKey, jwk }
}

async function signIdToken({
  key,
  alg,
  issuer = config.issuerUrl,
  audience = config.clientId,
  expSecondsFromNow = 3600,
  claims = {},
}: {
  key: SigningKey
  alg: string
  issuer?: string
  audience?: string
  expSecondsFromNow?: number
  claims?: Record<string, unknown>
}): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)
  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid: key.jwk.kid })
    .setSubject((claims.sub as string) ?? "user-123")
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expSecondsFromNow)
    .sign(key.privateKey)
}

// A syntactically valid alg:none token (jose refuses to sign one via SignJWT).
function makeAlgNoneToken(): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url")
  const header = b64({ alg: "none", typ: "JWT" })
  const payload = b64({
    sub: "user-123",
    iss: config.issuerUrl,
    aud: config.clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  return `${header}.${payload}.`
}

// ── fetch mock: routes JWKS + token endpoints, counts JWKS fetches ───────────

let jwksKeys: JWK[] = []
let jwksFetchCount = 0

function installFetchMock() {
  jwksFetchCount = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(
        input instanceof Request ? input.url : (input as URL | string),
      )
      if (url.endsWith("/jwks")) {
        jwksFetchCount += 1
        return new Response(JSON.stringify({ keys: jwksKeys }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

beforeEach(() => {
  __resetChatOAuthCaches()
  jwksKeys = []
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ── authorize URL / endpoint shape ───────────────────────────────────────────

describe("buildChatAuthorizeUrl", () => {
  it("requests identity-only scopes and never admin:access, with S256 PKCE", () => {
    const url = buildChatAuthorizeUrl({
      config,
      state: "state-abc",
      codeChallenge: "challenge-xyz",
    })
    expect(url.searchParams.get("scope")).toBe("openid profile:read email:read")
    expect(url.searchParams.get("scope")).not.toContain("admin:access")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe("state-abc")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://chat.example.com/api/auth/callback",
    )
    expect(url.searchParams.get("client_id")).toBe("chat-client")
  })

  it("resolves the authorize endpoint against the issuer ORIGIN via new URL()", () => {
    const trailingSlash = buildChatAuthorizeUrl({
      config: { ...config, issuerUrl: "https://auth.example.com/api/auth/" },
      state: "s",
      codeChallenge: "c",
    })
    const bareOrigin = buildChatAuthorizeUrl({
      config: { ...config, issuerUrl: "https://auth.example.com" },
      state: "s",
      codeChallenge: "c",
    })
    // Absolute-path form: same authorize path regardless of issuer shape (KTD3);
    // string concatenation would 404 on a trailing slash or a bare origin.
    expect(trailingSlash.pathname).toBe("/api/auth/oauth2/authorize")
    expect(bareOrigin.pathname).toBe("/api/auth/oauth2/authorize")
  })
})

// ── verifyChatIdToken (R9 / KTD3) ────────────────────────────────────────────

describe("verifyChatIdToken — happy path", () => {
  it("returns identity claims for a valid EdDSA id_token (F1, apps/auth default)", async () => {
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    const token = await signIdToken({
      key,
      alg: "EdDSA",
      claims: {
        sub: "user-123",
        name: "Ada Lovelace",
        email: "ada@example.com",
        picture: "https://cdn.example.com/ada.png",
      },
    })

    const identity = await verifyChatIdToken({ config, idToken: token })
    expect(identity).toEqual({
      subject: "user-123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      picture: "https://cdn.example.com/ada.png",
    })
  })

  it("leaves picture undefined for an avatar-less user (nullable user.image)", async () => {
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    const token = await signIdToken({
      key,
      alg: "EdDSA",
      claims: { sub: "u1", name: "No Avatar", email: "n@example.com" },
    })
    const identity = await verifyChatIdToken({ config, idToken: token })
    expect(identity.picture).toBeUndefined()
    expect(identity.name).toBe("No Avatar")
  })
})

describe("verifyChatIdToken — R9 rejections (net-new vs admin's verifier)", () => {
  it("throws id_token_missing when no id_token is present (NO access-token fallback)", async () => {
    await expect(
      verifyChatIdToken({ config, idToken: undefined }),
    ).rejects.toMatchObject({ code: "id_token_missing" })
  })

  it("rejects an alg:none token", async () => {
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    await expect(
      verifyChatIdToken({ config, idToken: makeAlgNoneToken() }),
    ).rejects.toMatchObject({ code: "id_token_alg_not_allowed" })
  })

  it("rejects a valid ASYMMETRIC alg that is outside the derived allowlist — the allowlist gates specifically", async () => {
    // JWKS publishes only an Ed25519 key → derived allowlist is exactly [EdDSA].
    const edKey = await makeKey("EdDSA", "k-ed")
    jwksKeys = [edKey.jwk]
    // A genuinely ES256-signed token: jose checks `algorithms` BEFORE key
    // resolution, so this is rejected purely by the allowlist (not by a missing
    // key) — proving the allowlist, not createRemoteJWKSet, is the barrier here.
    const esKey = await makeKey("ES256", "k-es")
    const esToken = await signIdToken({ key: esKey, alg: "ES256" })
    // Distinct code reachable ONLY via the allowlist path — so this assertion
    // can't be satisfied by an unrelated bad token (unlike generic id_token_invalid).
    await expect(
      verifyChatIdToken({ config, idToken: esToken }),
    ).rejects.toMatchObject({ code: "id_token_alg_not_allowed" })
    // Non-vacuous counterpart: the SAME alg verifies when the JWKS DOES publish
    // an ES256 key — so only the allowlist differed between accept and reject.
    __resetChatOAuthCaches()
    const esKey2 = await makeKey("ES256", "k-es2")
    jwksKeys = [esKey2.jwk]
    const esToken2 = await signIdToken({ key: esKey2, alg: "ES256" })
    await expect(
      verifyChatIdToken({ config, idToken: esToken2 }),
    ).resolves.toMatchObject({ subject: "user-123" })
  })

  it("rejects on issuer mismatch", async () => {
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    const token = await signIdToken({
      key,
      alg: "EdDSA",
      issuer: "https://evil.example.com/api/auth",
    })
    // Distinct code so a wrong AUTH_ISSUER_URL is greppable, not silent churn.
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).rejects.toMatchObject({ code: "id_token_iss_mismatch" })
  })

  it("rejects when audience is not chat's client id (distinct code — client-id misconfig alarm)", async () => {
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    const token = await signIdToken({
      key,
      alg: "EdDSA",
      audience: "some-other-client",
    })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).rejects.toMatchObject({ code: "id_token_aud_mismatch" })
  })

  it("rejects an expired id_token with a distinct expiry code", async () => {
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    const token = await signIdToken({
      key,
      alg: "EdDSA",
      expSecondsFromNow: -100,
    })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).rejects.toMatchObject({ code: "id_token_expired" })
  })
})

describe("verifyChatIdToken — allowlist derivation over kty+crv", () => {
  it("derives EdDSA from an OKP/Ed25519 key with no explicit alg", async () => {
    const key = await makeKey("EdDSA", "k-ed") // exported JWK omits alg
    expect(key.jwk.alg).toBeUndefined()
    jwksKeys = [key.jwk]
    const token = await signIdToken({ key, alg: "EdDSA" })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).resolves.toMatchObject({ subject: "user-123" })
  })

  it("derives ES256 from an EC/P-256 key (EC branch exercised, not only EdDSA)", async () => {
    const key = await makeKey("ES256", "k-es")
    expect(key.jwk.crv).toBe("P-256")
    jwksKeys = [key.jwk]
    const token = await signIdToken({ key, alg: "ES256" })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).resolves.toMatchObject({ subject: "user-123" })
  })

  it("fails closed LOUDLY on an unrecognized kty with no explicit alg (no session + logged config-error code)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    // A bogus key type with no `alg` → contributes nothing → empty allowlist →
    // every token rejected (the R9-safe direction), and the config error logged.
    jwksKeys = [{ kty: "BOGUS", kid: "k-bad" } as unknown as JWK]
    const anyKey = await makeKey("EdDSA", "k-ed")
    const token = await signIdToken({ key: anyKey, alg: "EdDSA" })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).rejects.toBeInstanceOf(ChatAuthError)
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("event=jwks_alg_unrecognized"),
    )
    err.mockRestore()
  })

  it("fails closed with jwks_unavailable when the JWKS fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    )
    const key = await makeKey("EdDSA", "k-ed")
    const token = await signIdToken({ key, alg: "EdDSA" })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).rejects.toMatchObject({ code: "jwks_unavailable" })
  })

  it("fails closed EXPLICITLY on an empty JWKS — the allowlist guard, not jose's empty-array semantics", async () => {
    // No keys at all → derived allowlist is empty → we throw jwks_unavailable
    // BEFORE calling jwtVerify, rather than relying on jose to reject an empty
    // `algorithms` array (R9 — an empty pin must never mean "no restriction").
    jwksKeys = []
    const key = await makeKey("EdDSA", "k-ed")
    const token = await signIdToken({ key, alg: "EdDSA" })
    await expect(
      verifyChatIdToken({ config, idToken: token }),
    ).rejects.toMatchObject({ code: "jwks_unavailable" })
  })
})

describe("verifyChatIdToken — allowlist cache invalidation (KTD3, not pinned for process lifetime)", () => {
  it("re-derives the allowlist after the TTL, but not on a warm-cache re-verify", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const key = await makeKey("EdDSA", "k-ed")
    jwksKeys = [key.jwk]
    const token = await signIdToken({ key, alg: "EdDSA" })

    await verifyChatIdToken({ config, idToken: token })
    const afterFirst = jwksFetchCount
    expect(afterFirst).toBeGreaterThan(0)

    // Warm cache: an immediate re-verify must not re-fetch the JWKS for alg
    // derivation (the key resolver's cache is also warm).
    await verifyChatIdToken({ config, idToken: token })
    expect(jwksFetchCount).toBe(afterFirst)

    // Past the derived-allowlist TTL: the allowlist re-derives → a fresh fetch.
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    await verifyChatIdToken({ config, idToken: token })
    expect(jwksFetchCount).toBeGreaterThan(afterFirst)
  })

  it("does NOT re-fetch the JWKS on an alg-mismatch within the cooldown (amplification guard)", async () => {
    // JWKS publishes only EdDSA; a stream of ES256 tokens would each force a
    // re-derive. The cooldown must collapse those to the single derive fetch —
    // otherwise an attacker amplifies one request into one outbound JWKS fetch.
    const edKey = await makeKey("EdDSA", "k-ed")
    jwksKeys = [edKey.jwk]
    const esKey = await makeKey("ES256", "k-es")
    const esToken = await signIdToken({ key: esKey, alg: "ES256" })

    await expect(
      verifyChatIdToken({ config, idToken: esToken }),
    ).rejects.toMatchObject({ code: "id_token_alg_not_allowed" })
    // Exactly one derive fetch: the forced re-derive was suppressed by the
    // cooldown (jose rejects ES256 at the alg-check before key resolution, so
    // createRemoteJWKSet never fetches here).
    expect(jwksFetchCount).toBe(1)

    // A second mismatch token within the cooldown adds no fetch at all.
    const esToken2 = await signIdToken({ key: esKey, alg: "ES256" })
    await expect(
      verifyChatIdToken({ config, idToken: esToken2 }),
    ).rejects.toMatchObject({ code: "id_token_alg_not_allowed" })
    expect(jwksFetchCount).toBe(1)
  })

  it("self-heals on a rotation to a new asymmetric alg (forced re-derive SUCCEEDS)", async () => {
    // The success side of the alg-mismatch → force re-derive → retry path. If
    // this regressed (force dropped, re-fetch not firing, cooldown mis-gated),
    // every post-rotation sign-in would silently go anonymous with no failing
    // test — the exact R9/KTD3 silent-anonymous mode. This is U3's scenario.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const edKey = await makeKey("EdDSA", "k-ed")
    jwksKeys = [edKey.jwk]
    const oldToken = await signIdToken({ key: edKey, alg: "EdDSA" })
    await verifyChatIdToken({ config, idToken: oldToken }) // warms [EdDSA] pin
    const afterWarm = jwksFetchCount
    expect(afterWarm).toBeGreaterThan(0)

    // Advance INTO the window (cooldown 30s) < advance < (TTL 5min): the
    // non-force branch still returns the stale [EdDSA] pin → the ES256 token
    // triggers the force path, and the forced re-derive is past the cooldown so
    // it actually re-fetches. (Past the TTL it would self-heal on the non-force
    // branch instead, never exercising the force retry.)
    await vi.advanceTimersByTimeAsync(45 * 1000)
    const esKey = await makeKey("ES256", "k-es-new")
    jwksKeys = [esKey.jwk] // apps/auth rotated EdDSA → ES256
    const newToken = await signIdToken({ key: esKey, alg: "ES256" })

    const identity = await verifyChatIdToken({ config, idToken: newToken })
    expect(identity.subject).toBe("user-123") // retry resolved → identity returned
    // Proves the re-derive re-fetched the rotated JWKS, not reused the stale pin.
    expect(jwksFetchCount).toBeGreaterThan(afterWarm)
  })

  it("preserves jwks_unavailable when the forced re-derive's JWKS fetch fails (not id_token_invalid)", async () => {
    // Compound scenario: alg-mismatch + cooldown expired + JWKS blip on the
    // retry. The inner retry catch must pass the ChatAuthError code through
    // rather than relabel it id_token_invalid, or the operator alarm is lost
    // (KTD7). Fails without the inner `instanceof ChatAuthError` passthrough.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const edKey = await makeKey("EdDSA", "k-ed")
    jwksKeys = [edKey.jwk]
    const oldToken = await signIdToken({ key: edKey, alg: "EdDSA" })
    await verifyChatIdToken({ config, idToken: oldToken }) // warm [EdDSA]

    const esKey = await makeKey("ES256", "k-es-new")
    const esToken = await signIdToken({ key: esKey, alg: "ES256" })
    await vi.advanceTimersByTimeAsync(45 * 1000) // force re-derive will re-fetch
    // The JWKS endpoint blips right when the forced re-derive fetches.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    )

    await expect(
      verifyChatIdToken({ config, idToken: esToken }),
    ).rejects.toMatchObject({ code: "jwks_unavailable" })
  })
})
