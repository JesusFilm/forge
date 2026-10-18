// Strict verifier for the delegated Web user's access token on the Watch SEO
// surface (feat-712). It is deliberately NOT a reuse of
// `resolveWebUserPrincipalFromToken`: that path admits TV clients, requires the
// watch-events scope, and treats the environment claim as optional. This one
// admits only Web clients, fails closed on absent configuration, and requires
// the environment claim in production. It yields a subject only; the caller
// maps the subject to an Admin user and re-reads the live role.

import { env } from "@/config/env"

const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"
const INTROSPECTION_TIMEOUT_MS = 3000
// An introspection response is a few hundred bytes; the cap keeps a
// misbehaving upstream from buffering into the shared Admin process.
const INTROSPECTION_MAX_BYTES = 32 * 1024
const MAX_TOKEN_LENGTH = 4096
const MAX_SUBJECT_LENGTH = 191
const BEARER = /^Bearer\s+(\S+)$/i

// Used only when AUTH_WEB_USER_CLIENT_IDS is unset. TV ids are excluded by
// construction here AND filtered out of any configured list below.
const DEFAULT_WEB_CLIENT_IDS = [
  "jfp_web_local",
  "jfp_web_preview",
  "jfp_web_staging",
  "jfp_web_production",
]
const WEB_CLIENT_ID_PREFIX = "jfp_web_"

export type WatchSeoUserTokenFailure =
  | "config_absent"
  | "missing_token"
  | "introspection_failed"
  | "inactive"
  | "issuer_mismatch"
  | "client_not_web"
  | "environment_unconfigured"
  | "environment_mismatch"
  | "expired"
  | "subject_missing"

export type WatchSeoUserTokenResult =
  | { ok: true; subject: string }
  | { ok: false; reason: WatchSeoUserTokenFailure }

type IntrospectionPayload = {
  active?: unknown
  client_id?: unknown
  exp?: unknown
  iss?: unknown
  sub?: unknown
  [ENVIRONMENT_CLAIM]?: unknown
}

type Deps = { fetchImpl?: typeof fetch; now?: () => number }

function isProduction(): boolean {
  return env.NODE_ENV === "production"
}

function webClientIds(): Set<string> {
  const configured = env.AUTH_WEB_USER_CLIENT_IDS
    ? env.AUTH_WEB_USER_CLIENT_IDS.split(",")
    : DEFAULT_WEB_CLIENT_IDS
  return new Set(
    configured
      .map((value) => value.trim())
      .filter((value) => value.startsWith(WEB_CLIENT_ID_PREFIX)),
  )
}

async function readCappedJson(
  response: Response,
): Promise<IntrospectionPayload | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > INTROSPECTION_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // lock already released by cancel()
    }
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as IntrospectionPayload)
      : null
  } catch {
    return null
  }
}

export async function verifyWatchSeoUserToken(
  headerValue: string | null,
  deps: Deps = {},
): Promise<WatchSeoUserTokenResult> {
  const clientId = env.AUTH_WEB_USER_INTROSPECTION_CLIENT_ID
  const clientSecret = env.AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET
  const expectedEnvironment = env.AUTH_WEB_USER_TOKEN_ENVIRONMENT
  // Absent configuration fails closed. In production the environment claim is
  // mandatory: one Auth deployment issues every environment's clients, so
  // without it a token minted for another environment would be accepted.
  if (!clientId || !clientSecret || webClientIds().size === 0) {
    return { ok: false, reason: "config_absent" }
  }
  if (isProduction() && !expectedEnvironment) {
    return { ok: false, reason: "environment_unconfigured" }
  }

  const token = headerValue?.match(BEARER)?.[1]
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing_token" }
  }

  let response: Response
  try {
    response = await (deps.fetchImpl ?? fetch)(
      new URL("/api/auth/oauth2/introspect", env.AUTH_ISSUER_URL).toString(),
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token,
          token_type_hint: "access_token",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
      },
    )
  } catch {
    return { ok: false, reason: "introspection_failed" }
  }
  if (!response.ok) return { ok: false, reason: "introspection_failed" }

  let payload: IntrospectionPayload | null
  try {
    payload = await readCappedJson(response)
  } catch {
    payload = null
  }
  if (!payload) return { ok: false, reason: "introspection_failed" }

  if (payload.active !== true) return { ok: false, reason: "inactive" }
  if (payload.iss !== env.AUTH_ISSUER_URL.replace(/\/$/, "")) {
    return { ok: false, reason: "issuer_mismatch" }
  }
  if (
    typeof payload.client_id !== "string" ||
    !webClientIds().has(payload.client_id)
  ) {
    return { ok: false, reason: "client_not_web" }
  }
  if (
    expectedEnvironment &&
    payload[ENVIRONMENT_CLAIM] !== expectedEnvironment
  ) {
    return { ok: false, reason: "environment_mismatch" }
  }
  const nowSeconds = Math.floor((deps.now ?? Date.now)() / 1000)
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" }
  }
  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > MAX_SUBJECT_LENGTH
  ) {
    return { ok: false, reason: "subject_missing" }
  }
  return { ok: true, subject: payload.sub }
}
