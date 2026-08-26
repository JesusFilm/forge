import { env } from "@/config/env"

const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"

export type ManagerServiceScope =
  | "admin:manager-session:validate"
  | "admin:manager-backend"

type IntrospectionResponse = {
  active?: boolean
  aud?: unknown
  client_id?: unknown
  exp?: unknown
  iss?: unknown
  scope?: unknown
  [ENVIRONMENT_CLAIM]?: unknown
}

export async function isValidManagerServiceToken(
  authHeader: string | null,
  requiredScope: ManagerServiceScope,
): Promise<boolean> {
  const token = parseBearerToken(authHeader)
  const expectedAudience = getManagerServiceAudience()
  if (
    !token ||
    !env.AUTH_MANAGER_SERVICE_CLIENT_ID ||
    !env.AUTH_MANAGER_SERVICE_CLIENT_SECRET ||
    !expectedAudience
  ) {
    return false
  }

  let response: Response
  try {
    response = await fetch(getIntrospectionUrl(), {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${env.AUTH_MANAGER_SERVICE_CLIENT_ID}:${env.AUTH_MANAGER_SERVICE_CLIENT_SECRET}`,
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
    return false
  }

  if (!response.ok) {
    return false
  }

  try {
    const payload = (await response.json()) as IntrospectionResponse
    return isUsableManagerServiceToken(payload, expectedAudience, requiredScope)
  } catch {
    return false
  }
}

function isUsableManagerServiceToken(
  payload: IntrospectionResponse,
  expectedAudience: string,
  requiredScope: ManagerServiceScope,
) {
  if (payload.active !== true) return false
  if (payload.iss !== env.AUTH_ISSUER_URL.replace(/\/$/, "")) return false
  if (payload.aud !== expectedAudience) return false
  if (payload.client_id !== env.AUTH_MANAGER_SERVICE_CLIENT_ID) return false
  if (
    env.AUTH_MANAGER_SERVICE_ENVIRONMENT &&
    payload[ENVIRONMENT_CLAIM] !== env.AUTH_MANAGER_SERVICE_ENVIRONMENT
  ) {
    return false
  }
  if (!hasScope(payload.scope, requiredScope)) return false
  if (typeof payload.exp !== "number") return false
  return payload.exp > Math.floor(Date.now() / 1000)
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

function getIntrospectionUrl() {
  return new URL("/api/auth/oauth2/introspect", env.AUTH_ISSUER_URL).toString()
}

function getManagerServiceAudience() {
  return (
    env.AUTH_MANAGER_SERVICE_AUDIENCE ??
    new URL(
      "/api/manager/session",
      env.ADMIN_BASE_URL ?? "http://localhost:3003",
    ).toString()
  )
}

function parseBearerToken(authHeader: string | null) {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}
