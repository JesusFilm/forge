import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { env } from "@/config/env"

import { ChatAuthError, type ChatAuthErrorCode } from "./errors"

/**
 * Chat's OAuth client against apps/auth (feat-207). Adapted from
 * apps/admin/src/auth/oauth-client.ts — the authorize/exchange plumbing and the
 * `new URL(absolutePath, issuerUrl)` endpoint form are ported verbatim, but
 * `verifyChatIdToken` DELIBERATELY DIVERGES from admin's verifier (R9/KTD3):
 * it verifies the id_token ONLY (no `idToken ?? accessToken` fallback), and it
 * pins a JWKS-derived `algorithms` allowlist that admin omits. Admin is safe
 * without either only because it additionally gates on `admin:access`; chat
 * gates nothing, so the signature check is chat's sole barrier.
 */
export type ChatOAuthConfig = {
  issuerUrl: string
  clientId: string
  clientSecret?: string
  chatBaseUrl: string
}

export type VerifiedChatIdentity = {
  subject: string
  name?: string
  email?: string
  picture?: string
  emailVerified?: boolean
}

/**
 * Identity-only scopes — NEVER admin:access (chat performs no authorization,
 * R7). apps/auth registers the `:read` keys, and `openid` is what makes it emit
 * an id_token; the profile/email claims reach the token via customIdTokenClaims
 * regardless.
 */
const CHAT_OAUTH_SCOPES = ["openid", "profile:read", "email:read"] as const

// Outbound fetch budget for the token exchange + JWKS fetch. Must stay shorter
// than the callback's own ceiling so a hung apps/auth fails closed to anonymous
// rather than hanging the request (outbound-timeout learning).
const AUTH_FETCH_TIMEOUT_MS = 10_000

/**
 * Derived-allowlist cache TTL. Short so a key rotation on apps/auth's side is
 * picked up without a redeploy (KTD3 — a process-lifetime pin would keep
 * rejecting every post-rotation id_token). Re-derivation on an alg-mismatch
 * verify failure (below) is the other half of the invalidation.
 */
const ALG_CACHE_TTL_MS = 5 * 60 * 1000
/**
 * Minimum interval between ACTUAL JWKS refetches, including forced re-derives on
 * an alg-mismatch. Without this floor, an attacker sending a stream of
 * non-allowlisted-alg id_tokens would force one outbound JWKS fetch per request
 * (an amplification vector, since the auth routes ship un-rate-limited in v1).
 * Mirrors createRemoteJWKSet's own 30s cooldown; a real rotation is still picked
 * up within this window.
 */
const ALG_REFETCH_COOLDOWN_MS = 30 * 1000

/**
 * Read chat's OAuth config from env. Throws `config_missing` when a required
 * field is absent — callers gate on `chatAuthConfigured()` first, so this is a
 * defensive fail-closed, not the normal path.
 */
export function getChatOAuthConfig(): ChatOAuthConfig {
  const issuerUrl = env.AUTH_ISSUER_URL
  const clientId = env.AUTH_CHAT_CLIENT_ID
  const chatBaseUrl = env.CHAT_BASE_URL

  if (!issuerUrl || !clientId || !chatBaseUrl) {
    throw new ChatAuthError("config_missing")
  }

  return {
    issuerUrl: issuerUrl.replace(/\/$/, ""),
    clientId,
    clientSecret: env.AUTH_CHAT_CLIENT_SECRET,
    chatBaseUrl: chatBaseUrl.replace(/\/$/, ""),
  }
}

/** The exact redirect URI apps/auth must have registered for this environment. */
export function getChatOAuthRedirectUri(config: ChatOAuthConfig) {
  return `${config.chatBaseUrl}/api/auth/callback`
}

/**
 * Build the apps/auth authorize URL with identity-only scopes + PKCE S256 (R1).
 * prompt: "login" forces the provider's login page even with a live SSO session
 * (feat-240 force-login marker); omitted → the provider's default behavior.
 */
export function buildChatAuthorizeUrl({
  config,
  state,
  codeChallenge,
  prompt,
}: {
  config: ChatOAuthConfig
  state: string
  codeChallenge: string
  prompt?: "login"
}) {
  const url = new URL("/api/auth/oauth2/authorize", config.issuerUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", getChatOAuthRedirectUri(config))
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", CHAT_OAUTH_SCOPES.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (prompt) {
    url.searchParams.set("prompt", prompt)
  }

  return url
}

/** Exchange the authorization code for tokens (R1). Times out per AUTH_FETCH_TIMEOUT_MS. */
export async function exchangeChatAuthorizationCode({
  config,
  code,
  codeVerifier,
}: {
  config: ChatOAuthConfig
  code: string
  codeVerifier: string
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getChatOAuthRedirectUri(config),
    client_id: config.clientId,
    code_verifier: codeVerifier,
  })

  const headers: HeadersInit = {
    "content-type": "application/x-www-form-urlencoded",
  }

  if (config.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64")}`
  }

  try {
    const response = await fetch(
      new URL("/api/auth/oauth2/token", config.issuerUrl),
      {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
      },
    )
    if (!response.ok) throw new ChatAuthError("token_exchange_failed")
    // Parse INSIDE the try so a malformed/aborted body classifies as
    // token_exchange_failed rather than escaping as a raw SyntaxError/AbortError
    // (whose message could embed body fragments).
    return (await response.json()) as {
      access_token: string
      id_token?: string
      scope?: string
    }
  } catch (error) {
    // No message logged — the caught error may embed request/body detail.
    if (error instanceof ChatAuthError) throw error
    throw new ChatAuthError("token_exchange_failed")
  }
}

// ── id_token verification (R9 / KTD3) ───────────────────────────────────────

type JsonWebKey = {
  kty?: string
  crv?: string
  alg?: string
}

// module-level caches. Both key on issuerUrl so a config change never serves a
// stale allowlist/keyset (the issuer is a single startup env var today, so this
// is defensive parity rather than a live multi-issuer path).
let algCache: {
  issuerUrl: string
  algorithms: string[]
  fetchedAt: number
} | null = null
let jwksCache: {
  issuerUrl: string
  jwks: ReturnType<typeof createRemoteJWKSet>
} | null = null

/** Test-only: clear the JWKS + derived-allowlist caches between cases. */
export function __resetChatOAuthCaches() {
  algCache = null
  jwksCache = null
}

function jwksUrl(config: ChatOAuthConfig): URL {
  return new URL("/api/auth/jwks", config.issuerUrl)
}

function getJwks(config: ChatOAuthConfig) {
  if (jwksCache && jwksCache.issuerUrl === config.issuerUrl) {
    return jwksCache.jwks
  }
  // createRemoteJWKSet resolves only ASYMMETRIC keys — it, not the algorithms
  // allowlist, is the symmetric-key (HS*) confusion barrier. It self-heals on
  // an unknown `kid` by re-fetching (KTD3).
  const jwks = createRemoteJWKSet(jwksUrl(config), {
    timeoutDuration: AUTH_FETCH_TIMEOUT_MS,
  })
  jwksCache = { issuerUrl: config.issuerUrl, jwks }
  return jwks
}

/**
 * Map a JWK with no explicit `alg` to its signing algorithm from kty+crv. An
 * unrecognized pair returns `null` — the caller drops it AND logs loudly (KTD3):
 * contributing nothing keeps the allowlist correct, silently dropping would let
 * an empty allowlist reproduce the "every sign-in goes anonymous, no alarm"
 * failure R9 exists to prevent.
 */
function algFromKeyType(key: JsonWebKey): string | null {
  if (key.kty === "OKP") {
    if (key.crv === "Ed25519" || key.crv === "Ed448") return "EdDSA"
    return null
  }
  if (key.kty === "EC") {
    if (key.crv === "P-256") return "ES256"
    if (key.crv === "P-384") return "ES384"
    if (key.crv === "P-521") return "ES512"
    return null
  }
  // RSA maps to RS256 only — the common issuer default. Revisit if apps/auth
  // ever publishes an alg-less RSA key intended for RS384/512 or PS*.
  if (key.kty === "RSA") return "RS256"
  return null
}

/**
 * Derive the id_token algorithm allowlist from apps/auth's published JWKS. The
 * allowlist's real jobs (KTD3): reject `alg: none`, and TRACK a key rotation to
 * a different asymmetric alg so a hardcoded pin can't silently reject every
 * id_token. Prefers each key's explicit `alg`; else derives from kty+crv; fails
 * closed loudly on an unrecognized key.
 */
async function fetchIdTokenAlgorithms(
  config: ChatOAuthConfig,
): Promise<string[]> {
  let keys: JsonWebKey[]
  try {
    const response = await fetch(jwksUrl(config), {
      redirect: "error",
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error("jwks_not_ok")
    const body = (await response.json()) as { keys?: JsonWebKey[] }
    keys = Array.isArray(body.keys) ? body.keys : []
  } catch {
    // No message logged — fail closed rather than verify without a pin.
    throw new ChatAuthError("jwks_unavailable")
  }

  const algorithms = new Set<string>()
  for (const key of keys) {
    // `alg: none` is filtered here; algFromKeyType never returns "none", so
    // `derived` truthiness is the only gate needed below.
    const explicit =
      typeof key.alg === "string" && key.alg !== "none" ? key.alg : undefined
    const derived = explicit ?? algFromKeyType(key)
    if (derived) {
      algorithms.add(derived)
    } else if (!explicit) {
      // Unrecognized kty/crv with no explicit alg — fail closed LOUDLY (KTD3).
      // kty/crv are not secret, so this is a safe, non-PII config-error signal.
      console.error(
        `[chat-auth] event=jwks_alg_unrecognized kty=${key.kty ?? "none"} crv=${key.crv ?? "none"}`,
      )
    }
  }

  // Fail closed on an empty allowlist explicitly (KTD3) rather than relying on
  // jose rejecting an empty `algorithms` array — an empty pin is the exact
  // "every sign-in silently goes anonymous" mode R9 exists to prevent.
  if (algorithms.size === 0) {
    throw new ChatAuthError("jwks_unavailable")
  }

  return [...algorithms]
}

/**
 * The derived allowlist, cached with a bounded TTL (KTD3). `force` re-derives on
 * an alg-mismatch to pick up a rotation — but still honors ALG_REFETCH_COOLDOWN_MS
 * so repeated mismatch tokens can't hammer the JWKS endpoint (they reuse the
 * cached allowlist and simply fail again, no fetch).
 */
async function getIdTokenAlgorithms(
  config: ChatOAuthConfig,
  force = false,
): Promise<string[]> {
  const now = Date.now()
  const cached = algCache?.issuerUrl === config.issuerUrl ? algCache : null
  if (cached) {
    const age = now - cached.fetchedAt
    if (force ? age < ALG_REFETCH_COOLDOWN_MS : age < ALG_CACHE_TTL_MS) {
      return cached.algorithms
    }
  }
  const algorithms = await fetchIdTokenAlgorithms(config)
  algCache = { issuerUrl: config.issuerUrl, algorithms, fetchedAt: now }
  return algorithms
}

/**
 * Verify the id_token and return the identity claims (R9). Verifies the
 * id_token ONLY — an absent id_token throws `id_token_missing` (no access-token
 * fallback). Pins the JWKS-derived algorithm allowlist and checks issuer +
 * audience (chat's client id) + expiry. On an alg-mismatch failure it re-derives
 * the allowlist ONCE (in case apps/auth rotated to a new asymmetric alg) before
 * giving up — so a stale cached pin can't strand a rotated issuer (KTD3).
 */
export async function verifyChatIdToken({
  config,
  idToken,
}: {
  config: ChatOAuthConfig
  idToken?: string
}): Promise<VerifiedChatIdentity> {
  if (!idToken) {
    throw new ChatAuthError("id_token_missing")
  }

  const jwks = getJwks(config)
  const verifyWith = async (algorithms: string[]): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: config.issuerUrl,
      audience: config.clientId,
      algorithms,
    })
    return payload
  }

  let payload: JWTPayload
  try {
    payload = await verifyWith(await getIdTokenAlgorithms(config))
  } catch (error) {
    if (isAlgNotAllowed(error)) {
      // Possible rotation to a new asymmetric alg — re-derive once, then retry.
      try {
        payload = await verifyWith(await getIdTokenAlgorithms(config, true))
      } catch (retryError) {
        // Mirror the outer catch: a re-derive that fails with jwks_unavailable
        // (JWKS fetch blip / empty allowlist) must keep that code, not collapse
        // to id_token_invalid — preserves the operator alarm (KTD7).
        if (retryError instanceof ChatAuthError) throw retryError
        throw new ChatAuthError(classifyVerifyFailure(retryError))
      }
    } else if (error instanceof ChatAuthError) {
      throw error
    } else {
      throw new ChatAuthError(classifyVerifyFailure(error))
    }
  }

  if (!payload.sub) {
    throw new ChatAuthError("id_token_invalid")
  }

  return {
    subject: payload.sub,
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    // Strict boolean (KTD6): a non-boolean value (e.g. the string "true") must
    // never read as verified — the seeker gate fails closed on anything else.
    emailVerified:
      typeof payload.email_verified === "boolean"
        ? payload.email_verified
        : undefined,
  }
}

function isAlgNotAllowed(error: unknown): boolean {
  return errorCode(error) === "ERR_JOSE_ALG_NOT_ALLOWED"
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? code : undefined
  }
  return undefined
}

/**
 * Map a jose verify failure to a distinct non-PII reason code so an operator can
 * tell an expired token (normal churn) from an aud/iss mismatch (a client-id or
 * issuer MISCONFIG — the R9 "everyone silently anonymous, no alarm" mode) from a
 * bad signature. Reads jose's typed `.code`/`.claim` (the claim NAME, never its
 * value — KTD7); anything unrecognized stays the generic id_token_invalid.
 */
function classifyVerifyFailure(error: unknown): ChatAuthErrorCode {
  switch (errorCode(error)) {
    case "ERR_JOSE_ALG_NOT_ALLOWED":
      return "id_token_alg_not_allowed"
    case "ERR_JWT_EXPIRED":
      return "id_token_expired"
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return "id_token_signature_invalid"
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      const claim = (error as { claim?: unknown }).claim
      if (claim === "aud") return "id_token_aud_mismatch"
      if (claim === "iss") return "id_token_iss_mismatch"
      return "id_token_claim_mismatch"
    }
    default:
      return "id_token_invalid"
  }
}
