import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { prisma } from "@/db/client"
import { env } from "@/config/env"
import type { Principal, Role } from "@/auth/principal"

const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"

export type AdminMcpOAuthConfig = {
  issuerUrl: string
  audience: string
  allowedClientIds?: string[]
  tokenEnvironment?: "local" | "preview" | "staging" | "production"
}

export type AdminMcpAuthErrorCode =
  | "missing_token"
  | "invalid_token"
  | "invalid_client"
  | "insufficient_scope"
  | "inactive_user"
  | "forbidden_role"

export class AdminMcpAuthError extends Error {
  constructor(
    readonly code: AdminMcpAuthErrorCode,
    message: string,
    readonly requiredScopes: readonly string[] = [],
  ) {
    super(message)
    this.name = "AdminMcpAuthError"
  }
}

export type VerifiedAdminMcpToken = {
  subject: string
  email?: string
  name?: string
  scopes: string[]
  clientId?: string
  claims: JWTPayload
}

export type VerifiedAdminMcpPrincipal = {
  token: VerifiedAdminMcpToken
  principal: Principal
}

export function getAdminMcpOAuthConfig(): AdminMcpOAuthConfig {
  return {
    issuerUrl: env.AUTH_ISSUER_URL.replace(/\/$/, ""),
    audience: env.AUTH_ADMIN_MCP_AUDIENCE ?? getDefaultAdminMcpAudience(),
    allowedClientIds: env.AUTH_ADMIN_MCP_CLIENT_IDS
      ? parseCsv(env.AUTH_ADMIN_MCP_CLIENT_IDS)
      : undefined,
    tokenEnvironment: env.AUTH_ADMIN_MCP_TOKEN_ENVIRONMENT,
  }
}

export async function verifyAdminMcpBearerToken({
  authHeader,
  requiredScopes,
  config = getAdminMcpOAuthConfig(),
}: {
  authHeader: string | null
  requiredScopes: readonly string[]
  config?: AdminMcpOAuthConfig
}): Promise<VerifiedAdminMcpToken> {
  const token = parseBearerToken(authHeader)
  if (!token) {
    throw new AdminMcpAuthError(
      "missing_token",
      "Admin MCP request is missing a bearer token.",
      requiredScopes,
    )
  }

  let payload: JWTPayload
  try {
    const jwks = createRemoteJWKSet(new URL("/api/auth/jwks", config.issuerUrl))
    const verified = await jwtVerify(token, jwks, {
      issuer: config.issuerUrl,
      audience: config.audience,
    })
    payload = verified.payload
  } catch {
    throw new AdminMcpAuthError(
      "invalid_token",
      "Admin MCP bearer token is invalid.",
      requiredScopes,
    )
  }

  const scopes = parseScopes(payload.scope)
  const missingScopes = requiredScopes.filter(
    (scope) => !scopes.includes(scope),
  )
  if (missingScopes.length > 0) {
    throw new AdminMcpAuthError(
      "insufficient_scope",
      `Admin MCP token is missing required scope(s): ${missingScopes.join(", ")}.`,
      requiredScopes,
    )
  }

  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined
  if (
    clientId &&
    config.allowedClientIds &&
    !config.allowedClientIds.includes(clientId)
  ) {
    throw new AdminMcpAuthError(
      "invalid_client",
      "Admin MCP token was issued to an unauthorized client.",
      requiredScopes,
    )
  }

  if (
    config.tokenEnvironment &&
    payload[ENVIRONMENT_CLAIM] !== config.tokenEnvironment
  ) {
    throw new AdminMcpAuthError(
      "invalid_token",
      "Admin MCP token environment is not accepted.",
      requiredScopes,
    )
  }

  if (!payload.sub) {
    throw new AdminMcpAuthError(
      "invalid_token",
      "Admin MCP token is missing a subject.",
      requiredScopes,
    )
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    scopes,
    clientId,
    claims: payload,
  }
}

export async function resolveAdminMcpPrincipal({
  authHeader,
  requiredScopes,
  config,
}: {
  authHeader: string | null
  requiredScopes: readonly string[]
  config?: AdminMcpOAuthConfig
}): Promise<VerifiedAdminMcpPrincipal> {
  const token = await verifyAdminMcpBearerToken({
    authHeader,
    requiredScopes,
    config,
  })

  const user = await findAdminUserForToken(token)
  if (!user) {
    throw new AdminMcpAuthError(
      "inactive_user",
      "Admin MCP token subject is not an active Admin user.",
      requiredScopes,
    )
  }

  if (!isAdminMcpRole(user.role)) {
    throw new AdminMcpAuthError(
      "forbidden_role",
      "Admin MCP requires an editor or admin user.",
      requiredScopes,
    )
  }

  return {
    token,
    principal: {
      id: user.id,
      role: user.role,
      rateLimitBucketKey: `admin-mcp:${user.id}`,
    },
  }
}

function getDefaultAdminMcpAudience() {
  return new URL(
    "/mcp",
    env.ADMIN_BASE_URL ?? "http://localhost:3003",
  ).toString()
}

function parseBearerToken(authHeader: string | null) {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function parseScopes(scope: unknown) {
  if (typeof scope !== "string") return []
  return scope
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function parseCsv(csv: string) {
  return csv
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

async function findAdminUserForToken(token: VerifiedAdminMcpToken) {
  if (token.email) {
    const user = await prisma.user.findUnique({
      where: { email: token.email },
      select: { id: true, role: true },
    })
    if (user) return user
  }

  return prisma.user.findUnique({
    where: { id: token.subject },
    select: { id: true, role: true },
  })
}

function isAdminMcpRole(
  role: string,
): role is Extract<Role, "ADMIN" | "EDITOR"> {
  return role === "ADMIN" || role === "EDITOR"
}
