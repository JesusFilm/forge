import { env } from "@/config/env"
import {
  parseReviewerLanguageGrants,
  type ReviewerLanguageGrant,
} from "@/lib/reviewer-session"

const MANAGER_SESSION_SCOPE = "admin:manager-session:validate"
const MANAGER_BACKEND_SCOPE = "admin:manager-backend"

export type AdminManagerSession = {
  user: {
    id: string
    email: string
    name?: string
  }
  managerRole: "OPERATOR" | "REVIEWER"
  reviewerLanguageGrants: ReviewerLanguageGrant[]
}

export async function validateAdminManagerSession({
  subject,
  email,
  name,
}: {
  subject: string
  email?: string
  name?: string
}): Promise<AdminManagerSession | null> {
  const sessionUrl = getAdminManagerSessionUrl()
  if (!sessionUrl || !hasManagerValidationCredential()) {
    throw new Error(
      "ADMIN_GRAPHQL_URL and either ADMIN_MANAGER_API_KEY or AUTH_MANAGER_SERVICE_CLIENT_ID/AUTH_MANAGER_SERVICE_CLIENT_SECRET are required for Manager access validation",
    )
  }
  const bearerToken = await getAdminManagerServiceBearer()

  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ subject, email, name }),
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error("Admin Manager access validation failed.")
  }

  const payload = (await response.json()) as {
    allowed?: boolean
    user?: { id?: unknown; email?: unknown; name?: unknown }
    managerRole?: unknown
    reviewerLanguageGrants?: unknown
  }

  const managerRole = payload.managerRole
  const reviewerLanguageGrants = parseReviewerLanguageGrants(
    payload.reviewerLanguageGrants ?? [],
  )

  if (
    payload.allowed !== true ||
    (managerRole !== "OPERATOR" && managerRole !== "REVIEWER") ||
    typeof payload.user?.id !== "string" ||
    typeof payload.user.email !== "string" ||
    !reviewerLanguageGrants ||
    (managerRole === "REVIEWER" && reviewerLanguageGrants.length === 0)
  ) {
    return null
  }

  return {
    user: {
      id: payload.user.id,
      email: payload.user.email,
      name:
        typeof payload.user.name === "string" ? payload.user.name : undefined,
    },
    managerRole,
    reviewerLanguageGrants,
  }
}

function hasManagerValidationCredential() {
  return (
    !!env.ADMIN_MANAGER_API_KEY ||
    (!!env.AUTH_ISSUER_URL &&
      !!env.AUTH_MANAGER_SERVICE_CLIENT_ID &&
      !!env.AUTH_MANAGER_SERVICE_CLIENT_SECRET)
  )
}

export async function getAdminManagerServiceBearer() {
  if (
    env.AUTH_ISSUER_URL &&
    env.AUTH_MANAGER_SERVICE_CLIENT_ID &&
    env.AUTH_MANAGER_SERVICE_CLIENT_SECRET
  ) {
    return requestManagerServiceToken()
  }

  if (!env.ADMIN_MANAGER_API_KEY) {
    throw new Error("ADMIN_MANAGER_API_KEY is required")
  }

  return env.ADMIN_MANAGER_API_KEY
}

/** OAuth-only credential for request-bound Admin session/locator exchanges. */
export async function getAdminManagerOAuthBearer() {
  if (
    !env.AUTH_ISSUER_URL ||
    !env.AUTH_MANAGER_SERVICE_CLIENT_ID ||
    !env.AUTH_MANAGER_SERVICE_CLIENT_SECRET
  ) {
    throw new Error("Manager OAuth service credentials are required")
  }
  return requestManagerServiceToken()
}

let managerServiceTokenCache: {
  accessToken: string
  expiresAtMs: number
} | null = null
let managerServiceTokenRequest: Promise<string> | null = null

async function requestManagerServiceToken() {
  if (
    managerServiceTokenCache &&
    managerServiceTokenCache.expiresAtMs > Date.now() + 30_000
  ) {
    return managerServiceTokenCache.accessToken
  }
  managerServiceTokenRequest ??= fetchManagerServiceToken().finally(() => {
    managerServiceTokenRequest = null
  })
  return managerServiceTokenRequest
}

async function fetchManagerServiceToken() {
  const resource = getAdminManagerSessionUrl()
  if (!resource) {
    throw new Error("ADMIN_GRAPHQL_URL is required for Manager service tokens")
  }
  const response = await fetch(getTokenUrl(), {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(
        `${env.AUTH_MANAGER_SERVICE_CLIENT_ID}:${env.AUTH_MANAGER_SERVICE_CLIENT_SECRET}`,
      ).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: `${MANAGER_SESSION_SCOPE} ${MANAGER_BACKEND_SCOPE}`,
      resource,
    }),
    signal: AbortSignal.timeout(3000),
  })

  if (!response.ok) {
    throw new Error("Manager service token request failed.")
  }

  const payload = (await response.json()) as {
    access_token?: unknown
    expires_in?: unknown
  }
  if (typeof payload.access_token !== "string") {
    throw new Error("Manager service token response did not include a token.")
  }

  if (
    typeof payload.expires_in === "number" &&
    Number.isFinite(payload.expires_in) &&
    payload.expires_in > 30
  ) {
    managerServiceTokenCache = {
      accessToken: payload.access_token,
      expiresAtMs: Date.now() + payload.expires_in * 1_000,
    }
  }

  return payload.access_token
}

function getTokenUrl() {
  return new URL("/api/auth/oauth2/token", env.AUTH_ISSUER_URL).toString()
}

function getAdminManagerSessionUrl() {
  if (env.ADMIN_MANAGER_SESSION_URL) {
    return env.ADMIN_MANAGER_SESSION_URL
  }
  if (!env.ADMIN_GRAPHQL_URL) {
    return undefined
  }

  return new URL("/api/manager/session", env.ADMIN_GRAPHQL_URL).toString()
}
