import { env } from "@/config/env"
import { WEB_USER_PRINCIPAL, type Principal } from "@/auth/principal"

const WATCH_EVENTS_SCOPE = "web:watch-events:write"
const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"

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
}

export async function resolveWebUserPrincipalFromToken(
  authHeader: string | null,
): Promise<Principal | null> {
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

  const payload = (await response.json()) as IntrospectionResponse
  const subject = usableWebUserSubject(payload)
  return subject ? WEB_USER_PRINCIPAL({ subject }) : null
}

function usableWebUserSubject(payload: IntrospectionResponse) {
  if (payload.active !== true) return null
  if (payload.iss !== env.AUTH_ISSUER_URL.replace(/\/$/, "")) return null
  if (typeof payload.client_id !== "string") return null
  if (!getExpectedClientIds().has(payload.client_id)) return null
  if (
    env.AUTH_WEB_USER_TOKEN_ENVIRONMENT &&
    payload[ENVIRONMENT_CLAIM] !== env.AUTH_WEB_USER_TOKEN_ENVIRONMENT
  ) {
    return null
  }
  if (!hasScope(payload.scope, WATCH_EVENTS_SCOPE)) return null
  if (typeof payload.exp !== "number") return null
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null
  return typeof payload.sub === "string" && payload.sub.length > 0
    ? payload.sub
    : null
}

function hasScope(scope: unknown, requiredScope: string) {
  return (
    typeof scope === "string" &&
    scope
      .split(" ")
      .filter((value) => value.length > 0)
      .includes(requiredScope)
  )
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
