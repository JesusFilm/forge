import { env } from "@/config/env"
import { WEB_USER_PRINCIPAL, type Principal } from "@/auth/principal"

const WATCH_EVENTS_SCOPE = "web:watch-events:write"
const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"
const APP_CLAIM = "https://jesusfilm.org/claims/app"
const MEMBERSHIP_CLAIM = "https://jesusfilm.org/claims/membership_status"
const PLAYLIST_SCOPES = [
  "playlist:read",
  "playlist:write",
  "playlist:share",
] as const

// Client ids accepted on a web-user token when AUTH_WEB_USER_CLIENT_IDS is
// unset. The TV ids join this default rather than staying env-only for two
// reasons. First, the default exists precisely so a freshly provisioned
// environment works without configuration; leaving TV out would mean a fresh
// environment silently rejects every TV token, and the symptom (an anonymous
// principal, no watch events recorded) points nowhere near this allowlist.
// Second, admitting a client id here grants nothing the checks below do not
// already grant: the TV client is deliberately issued
// `web:watch-events:write`, and issuer, expiry, and scope stay independently
// verified. The allowlist keeps clients that were never meant to write watch
// events (admin, MCP, chat) out.
//
// It is NOT the control that separates environments — but note the environment
// check below is conditional on AUTH_WEB_USER_TOKEN_ENVIRONMENT, which is
// `.optional()`. One Auth deployment issues every environment's clients (admin
// local dev points at production Auth), so `iss` does not separate them either.
// With BOTH vars unset there is no environment separation at all; that was
// already true of the four jfp_web_* defaults and is why every deployed
// environment should set AUTH_WEB_USER_TOKEN_ENVIRONMENT.
//
// Environments that PIN AUTH_WEB_USER_CLIENT_IDS still have to list the TV ids
// explicitly — this default only covers the unset case.
const DEFAULT_CLIENT_IDS = [
  "jfp_web_local",
  "jfp_web_preview",
  "jfp_web_staging",
  "jfp_web_production",
  "jfp_tv_local",
  "jfp_tv_preview",
  "jfp_tv_staging",
  "jfp_tv_production",
].join(",")

type IntrospectionResponse = {
  active?: boolean
  aud?: unknown
  client_id?: unknown
  exp?: unknown
  iss?: unknown
  scope?: unknown
  sub?: unknown
  [ENVIRONMENT_CLAIM]?: unknown
  [APP_CLAIM]?: unknown
  [MEMBERSHIP_CLAIM]?: unknown
}

export async function resolveWebUserPrincipalFromToken(
  authHeader: string | null,
): Promise<Principal | null> {
  const payload = await introspectWebUserToken(authHeader)
  if (!payload) return null
  const playlistSubject = usablePlaylistOwnerSubject(payload)
  if (playlistSubject) {
    return playlistOwnerPrincipal(payload, playlistSubject)
  }
  const subject = usableWebUserSubject(payload)
  return subject ? WEB_USER_PRINCIPAL({ subject }) : null
}

export async function resolvePlaylistOwnerPrincipalFromToken(
  authHeader: string | null,
): Promise<Principal | null> {
  const payload = await introspectWebUserToken(authHeader)
  if (!payload) return null
  const subject = usablePlaylistOwnerSubject(payload)
  if (!subject) return null
  return playlistOwnerPrincipal(payload, subject)
}

function playlistOwnerPrincipal(
  payload: IntrospectionResponse,
  subject: string,
) {
  const audience = normalizeAudience(payload.aud)
  const scopes = parseScopes(payload.scope)
  return WEB_USER_PRINCIPAL({
    subject,
    delegated: {
      active: true,
      issuer: payload.iss as string,
      audience,
      clientId: payload.client_id as string,
      environment: payload[ENVIRONMENT_CLAIM] as
        | "local"
        | "preview"
        | "staging"
        | "production",
      scopes,
    },
  })
}

async function introspectWebUserToken(
  authHeader: string | null,
): Promise<IntrospectionResponse | null> {
  const token = parseBearerToken(authHeader)
  if (
    !token ||
    !env.AUTH_WEB_USER_INTROSPECTION_CLIENT_ID ||
    !env.AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET
  ) {
    return null
  }

  let response: Response
  try {
    response = await fetch(getIntrospectionUrl(), {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${env.AUTH_WEB_USER_INTROSPECTION_CLIENT_ID}:${env.AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET}`,
        ).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token,
        token_type_hint: "access_token",
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  return (await response.json()) as IntrospectionResponse
}

function usableWebUserSubject(payload: IntrospectionResponse) {
  const subject = usableDelegatedSubject(payload)
  if (!subject) return null
  return hasScope(payload.scope, WATCH_EVENTS_SCOPE) ? subject : null
}

function usableDelegatedSubject(payload: IntrospectionResponse) {
  if (payload.active !== true) return null
  if (payload.iss !== env.AUTH_ISSUER_URL.replace(/\/$/, "")) return null
  if (typeof payload.client_id !== "string") return null
  if (!getExpectedClientIds().has(payload.client_id)) return null
  if (!isEnvironment(payload[ENVIRONMENT_CLAIM])) return null
  if (
    env.AUTH_WEB_USER_TOKEN_ENVIRONMENT &&
    payload[ENVIRONMENT_CLAIM] !== env.AUTH_WEB_USER_TOKEN_ENVIRONMENT
  ) {
    return null
  }
  if (typeof payload.exp !== "number") return null
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null
  return typeof payload.sub === "string" && payload.sub.length > 0
    ? payload.sub
    : null
}

function usablePlaylistOwnerSubject(payload: IntrospectionResponse) {
  const subject = usableDelegatedSubject(payload)
  if (!subject) return null
  if (!env.AUTH_WEB_USER_TOKEN_AUDIENCE) return null
  if (
    !normalizeAudience(payload.aud).includes(env.AUTH_WEB_USER_TOKEN_AUDIENCE)
  )
    return null
  if (payload[APP_CLAIM] !== "web") return null
  if (payload[MEMBERSHIP_CLAIM] !== "active") return null
  if (
    typeof payload.client_id !== "string" ||
    !payload.client_id.startsWith("jfp_web_")
  )
    return null
  const scopes = new Set(parseScopes(payload.scope))
  if (!PLAYLIST_SCOPES.some((scope) => scopes.has(scope))) return null
  return subject
}

function isEnvironment(
  value: unknown,
): value is "local" | "preview" | "staging" | "production" {
  return (
    value === "local" ||
    value === "preview" ||
    value === "staging" ||
    value === "production"
  )
}

function hasScope(scope: unknown, requiredScope: string) {
  return parseScopes(scope).includes(requiredScope)
}

function parseScopes(scope: unknown): string[] {
  return typeof scope === "string"
    ? [...new Set(scope.split(" ").filter((value) => value.length > 0))]
    : []
}

function normalizeAudience(audience: unknown): string[] {
  if (typeof audience === "string" && audience.length > 0) return [audience]
  if (
    Array.isArray(audience) &&
    audience.every((value) => typeof value === "string" && value.length > 0)
  ) {
    return [...new Set(audience)]
  }
  return []
}

function getExpectedClientIds() {
  const configured = env.AUTH_WEB_USER_CLIENT_IDS ?? DEFAULT_CLIENT_IDS
  return new Set(
    configured
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )
}

function getIntrospectionUrl() {
  return new URL("/api/auth/oauth2/introspect", env.AUTH_ISSUER_URL).toString()
}

function parseBearerToken(authHeader: string | null) {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}
