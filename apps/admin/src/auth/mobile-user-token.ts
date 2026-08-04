// Local (no-round-trip) verification of Auth-issued mobile user JWTs.
//
// The mobile app holds a short-lived JWT minted off its Auth session
// (better-auth jwt plugin). Admin verifies it against Auth's published JWKS
// and mints the `MOBILE_USER` principal — never introspection, which is why
// this branch sits BEFORE the web-user branch in the context chain (that
// branch spends a network round trip on every unrecognized bearer).
//
// Hardened per the JWKS-verification pattern in
// docs/solutions/architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md:
// the `algorithms` allowlist is DERIVED from the published JWKS (a hardcoded
// pin would silently reject every token after an alg rotation), cached with a
// bounded TTL, re-derived once on an alg-mismatch behind a refetch cooldown.
// `createRemoteJWKSet` (asymmetric-only, kid-refetch) is the symmetric-key
// barrier. Every rejection logs a distinct non-PII reason code; token and
// claim VALUES are never logged.

import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose"

import { env } from "@/config/env"
import { MOBILE_USER_PRINCIPAL, type Principal } from "@/auth/principal"

/** The session-stamped client claim Auth mints for mobile-app sessions. */
const MOBILE_CLIENT_CLAIM = "https://jesusfilm.org/claims/client"
const MOBILE_CLIENT_KIND = "mobile"

// Matches admin's existing 3s auth-call budget (web-user introspection).
const AUTH_FETCH_TIMEOUT_MS = 3000
const ALG_CACHE_TTL_MS = 10 * 60_000
// Mirrors createRemoteJWKSet's own 30s cooldown so a stream of bad-alg
// tokens cannot amplify into repeated outbound JWKS fetches.
const ALG_REFETCH_COOLDOWN_MS = 30_000

type MobileJwtRejectionReason =
  | "expired"
  | "aud_mismatch"
  | "iss_mismatch"
  | "signature_invalid"
  | "alg_not_allowed"
  | "jwks_unavailable"
  | "client_claim_missing"
  | "sub_missing"
  | "invalid"

// Module-level caches keyed on issuer so an env change never serves a stale
// keyset (defensive parity with the chat verifier; issuer is set at boot).
let algCache: {
  issuer: string
  algorithms: string[]
  fetchedAt: number
} | null = null
let jwksCache: {
  issuer: string
  jwks: ReturnType<typeof createRemoteJWKSet>
} | null = null

/**
 * The jwt plugin mints iss/aud as Auth's ORIGIN (no /api/auth path) — the
 * runtime-verified shape — unlike the oauthProvider tokens web introspects,
 * whose issuer carries the path. Derived from the same AUTH_ISSUER_URL.
 */
function expectedIssuer(): string {
  return new URL(env.AUTH_ISSUER_URL).origin
}

function jwksUrl(): URL {
  return new URL("/api/auth/jwks", env.AUTH_ISSUER_URL)
}

function getJwks(issuer: string) {
  if (jwksCache && jwksCache.issuer === issuer) return jwksCache.jwks
  const jwks = createRemoteJWKSet(jwksUrl(), {
    timeoutDuration: AUTH_FETCH_TIMEOUT_MS,
  })
  jwksCache = { issuer, jwks }
  return jwks
}

/** Map an alg-less JWK to its signing algorithm from kty+crv (total map). */
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
  if (key.kty === "RSA") return "RS256"
  return null
}

async function fetchAlgorithms(): Promise<string[]> {
  let keys: JsonWebKey[]
  try {
    const response = await fetch(jwksUrl(), {
      redirect: "error",
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error("jwks_not_ok")
    const body = (await response.json()) as { keys?: JsonWebKey[] }
    keys = Array.isArray(body.keys) ? body.keys : []
  } catch {
    throw new MobileJwtError("jwks_unavailable")
  }

  const algorithms = new Set<string>()
  for (const key of keys) {
    const explicit =
      typeof key.alg === "string" && key.alg !== "none" ? key.alg : undefined
    const derived = explicit ?? algFromKeyType(key)
    if (derived) {
      algorithms.add(derived)
    } else if (!explicit) {
      // Unrecognized kty/crv with no explicit alg — fail closed LOUDLY.
      console.warn(
        `[mobile-auth] event=jwks_alg_unrecognized kty=${key.kty ?? "none"} crv=${key.crv ?? "none"}`,
      )
    }
  }

  // Empty allowlist fails closed explicitly — never verify without a pin.
  if (algorithms.size === 0) throw new MobileJwtError("jwks_unavailable")

  return [...algorithms]
}

async function getAlgorithms(issuer: string, force = false): Promise<string[]> {
  const now = Date.now()
  const cached = algCache?.issuer === issuer ? algCache : null
  if (cached) {
    const age = now - cached.fetchedAt
    if (force ? age < ALG_REFETCH_COOLDOWN_MS : age < ALG_CACHE_TTL_MS) {
      return cached.algorithms
    }
  }
  const algorithms = await fetchAlgorithms()
  algCache = { issuer, algorithms, fetchedAt: now }
  return algorithms
}

class MobileJwtError extends Error {
  constructor(readonly reason: MobileJwtRejectionReason) {
    super(reason)
    this.name = "MobileJwtError"
  }
}

function classifyVerifyFailure(error: unknown): MobileJwtRejectionReason {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined
  if (code === "ERR_JWT_EXPIRED") return "expired"
  if (code === "ERR_JOSE_ALG_NOT_ALLOWED") return "alg_not_allowed"
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED")
    return "signature_invalid"
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    const claim = (error as { claim?: unknown }).claim
    if (claim === "aud") return "aud_mismatch"
    if (claim === "iss") return "iss_mismatch"
  }
  return "invalid"
}

function isAlgNotAllowed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_JOSE_ALG_NOT_ALLOWED"
  )
}

function logRejection(reason: MobileJwtRejectionReason) {
  console.warn(`[mobile-auth] event=mobile_jwt_rejected reason=${reason}`)
}

/**
 * Resolve a bearer to the MOBILE_USER principal, or null.
 *
 * Null covers both "not a JWT at all" (silent — every opaque bearer on the
 * context chain passes through here) and "a JWT that failed verification"
 * (logged with its distinct reason code, then fail-closed to null so the
 * chain continues; no principal is ever minted from an unverified token).
 */
export async function resolveMobileUserPrincipalFromToken(
  authHeader: string | null,
): Promise<Principal | null> {
  const token = parseBearerToken(authHeader)
  if (!token) return null

  // Cheap local dispatch: opaque bearers (workflow/consumer/web `jfp_at_`
  // keys) are not JWS-shaped and must not cost a JWKS fetch.
  try {
    decodeProtectedHeader(token)
  } catch {
    return null
  }

  const issuer = expectedIssuer()
  const jwks = getJwks(issuer)
  const verifyWith = async (algorithms: string[]): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: issuer,
      algorithms,
    })
    return payload
  }

  let payload: JWTPayload
  try {
    try {
      payload = await verifyWith(await getAlgorithms(issuer))
    } catch (error) {
      if (isAlgNotAllowed(error)) {
        // Possible rotation to a new asymmetric alg — re-derive once.
        payload = await verifyWith(await getAlgorithms(issuer, true))
      } else {
        throw error
      }
    }
  } catch (error) {
    logRejection(
      error instanceof MobileJwtError
        ? error.reason
        : classifyVerifyFailure(error),
    )
    return null
  }

  // Load-bearing: the jwt plugin mints off ANY Auth session (web, admin
  // dashboard, agent). Only sessions Auth stamped as mobile carry this
  // claim; without it the token is not acceptable as a mobile user.
  if (payload[MOBILE_CLIENT_CLAIM] !== MOBILE_CLIENT_KIND) {
    logRejection("client_claim_missing")
    return null
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    logRejection("sub_missing")
    return null
  }

  return MOBILE_USER_PRINCIPAL({ subject: payload.sub })
}

function parseBearerToken(authHeader: string | null) {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}
