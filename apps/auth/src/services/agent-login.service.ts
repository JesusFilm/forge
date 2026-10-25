import { randomBytes, randomUUID } from "node:crypto"

import { assertKnownScopes, type AuthScopeKey } from "@/domain/scopes"
import type { PrismaClient } from "@/generated/prisma"
import { isExactRedirectUriAllowed } from "@/services/app-registry.service"
import { buildAuditEvent } from "@/services/audit.service"

export const AGENT_LOGIN_HANDLE_DOMAIN = "agent-login.jesusfilm.internal"

const DEFAULT_HANDLE_TTL_SECONDS = 30 * 60
const MAX_HANDLE_TTL_SECONDS = 60 * 60

type AuthPrisma = PrismaClient

export type MintAgentLoginHandleInput = {
  clientId: string
  redirectUri: string
  requestedScopes?: readonly string[]
  ttlSeconds?: number
  now?: Date
  ipAddress?: string | null
  userAgent?: string | null
}

export type RedeemAgentLoginHandleInput = {
  handle: string
  oauthQuery?: string
  now?: Date
  ipAddress?: string | null
  userAgent?: string | null
}

export type RedeemedAgentLoginHandle = {
  email: string
  name: string
  userId: string
  callbackURL?: string
}

export class AgentLoginError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_handle"
      | "invalid_minting_key"
      | "invalid_oauth_context"
      | "invalid_scope"
      | "unsupported_environment",
  ) {
    super(message)
  }
}

export function isAgentLoginHandle(value: string) {
  return normalizeHandle(value).endsWith(`@${AGENT_LOGIN_HANDLE_DOMAIN}`)
}

export async function mintAgentLoginHandle(
  prisma: AuthPrisma,
  input: MintAgentLoginHandleInput,
) {
  const now = input.now ?? new Date()
  const environment = await prisma.appEnvironment.findUnique({
    where: { clientId: input.clientId },
    include: { app: true },
  })

  if (!environment) {
    await auditAgentLoginEvent(prisma, {
      eventType: "agent_login.mint_rejected",
      severity: "warning",
      subject: input.clientId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { reason: "invalid_oauth_context" },
    })
    throw new AgentLoginError(
      "Unknown OAuth client for agent login.",
      "invalid_oauth_context",
    )
  }

  assertMintingPolicy({
    appStatus: environment.app.status,
    defaultScopes: environment.defaultScopes,
    environmentKind: environment.kind,
    environmentStatus: environment.status,
    redirectUri: input.redirectUri,
    redirectUris: environment.redirectUris,
    requestedScopes: input.requestedScopes,
  })

  const scopes = resolveRequestedScopes(
    input.requestedScopes,
    environment.defaultScopes,
  )
  const handle = generateHandle(input.clientId)
  const expiresAt = new Date(
    now.getTime() + resolveTtlSeconds(input.ttlSeconds) * 1000,
  )

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        id: `agent_${randomUUID()}`,
        email: normalizeHandle(handle),
        name: "Agent",
        actorType: "AGENT",
        emailVerified: true,
        membershipStatus: "ACTIVE",
        expiresAt,
      },
      select: { id: true },
    })

    const grant = await tx.appGrant.create({
      data: {
        appId: environment.appId,
        environmentId: environment.id,
        subjectType: "USER",
        userId: createdUser.id,
        status: "APPROVED",
        approvedAt: now,
        reason: "Agent login handle mint",
      },
      select: { id: true },
    })

    const expectedScopes = [...new Set(scopes)]
    const scopeRecords = await tx.scope.findMany({
      where: { key: { in: expectedScopes } },
      select: { id: true, key: true },
    })
    if (scopeRecords.length !== expectedScopes.length) {
      throw new AgentLoginError(
        "Agent login handle references unknown scopes.",
        "invalid_scope",
      )
    }

    for (const scope of scopeRecords) {
      await tx.appGrantScope.create({
        data: {
          grantId: grant.id,
          scopeId: scope.id,
        },
      })
    }

    return createdUser
  })

  await auditAgentLoginEvent(prisma, {
    eventType: "agent_login.minted",
    actorUserId: user.id,
    appId: environment.appId,
    subject: input.clientId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      clientId: input.clientId,
      environmentKind: environment.kind,
      handle: "[redacted]",
      scopes,
      userId: user.id,
    },
  })

  return {
    handle,
    expiresAt,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    scopes,
    userId: user.id,
  }
}

export async function canRedeemAgentLoginHandle(
  prisma: AuthPrisma,
  input: Pick<RedeemAgentLoginHandleInput, "handle" | "oauthQuery" | "now">,
) {
  const normalizedHandle = normalizeHandle(input.handle)
  if (!isAgentLoginHandle(normalizedHandle)) return false

  try {
    parseOAuthContext(input.oauthQuery)
  } catch {
    return false
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedHandle },
    select: { actorType: true, expiresAt: true },
  })
  const now = input.now ?? new Date()

  return user?.actorType === "AGENT" && !!user.expiresAt && user.expiresAt > now
}

export async function redeemAgentLoginHandle(
  prisma: AuthPrisma,
  input: RedeemAgentLoginHandleInput,
): Promise<RedeemedAgentLoginHandle> {
  const normalizedHandle = normalizeHandle(input.handle)
  if (!isAgentLoginHandle(normalizedHandle)) {
    throw new AgentLoginError("Invalid agent login handle.", "invalid_handle")
  }

  const oauthContext = parseOAuthContext(input.oauthQuery)
  const now = input.now ?? new Date()

  const user = await prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: {
        email: normalizedHandle,
        actorType: "AGENT",
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    })

    if (claimed.count !== 1) {
      throw new AgentLoginError("Invalid agent login handle.", "invalid_handle")
    }

    return tx.user.findUniqueOrThrow({
      where: { email: normalizedHandle },
      select: { id: true, name: true },
    })
  })

  await auditAgentLoginEvent(prisma, {
    eventType: "agent_login.redeemed",
    actorUserId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      clientId: oauthContext.clientId,
      userId: user.id,
    },
  })

  return {
    email: normalizedHandle,
    name: user.name,
    userId: user.id,
    callbackURL: buildOAuthContinuationURL(input.oauthQuery),
  }
}

function assertMintingPolicy(input: {
  appStatus: string
  defaultScopes: readonly string[]
  environmentKind: string
  environmentStatus: string
  redirectUri: string
  redirectUris: readonly string[]
  requestedScopes?: readonly string[]
}) {
  if (input.appStatus !== "ACTIVE" || input.environmentStatus !== "APPROVED") {
    throw new AgentLoginError(
      "Agent login handles require an active approved OAuth client.",
      "invalid_oauth_context",
    )
  }

  if (!isRedeemableEnvironment(input.environmentKind)) {
    throw new AgentLoginError(
      "Agent login handles are only supported for local and preview clients.",
      "unsupported_environment",
    )
  }

  if (!isExactRedirectUriAllowed(input.redirectUri, input.redirectUris)) {
    throw new AgentLoginError(
      "Redirect URI is not allowed for this OAuth client.",
      "invalid_oauth_context",
    )
  }

  const scopes = resolveRequestedScopes(
    input.requestedScopes,
    input.defaultScopes,
  )
  const defaultScopes = new Set(assertKnownScopes(input.defaultScopes))
  const missingScopes = scopes.filter((scope) => !defaultScopes.has(scope))
  if (missingScopes.length > 0) {
    throw new AgentLoginError(
      `Requested scope(s) not allowed: ${missingScopes.join(", ")}`,
      "invalid_scope",
    )
  }
}

function resolveRequestedScopes(
  requestedScopes: readonly string[] | undefined,
  defaultScopes: readonly string[],
): AuthScopeKey[] {
  return assertKnownScopes(
    requestedScopes && requestedScopes.length > 0
      ? requestedScopes
      : defaultScopes,
  )
}

function parseOAuthContext(oauthQuery: string | undefined) {
  const params = new URLSearchParams(oauthQuery)
  const clientId = params.get("client_id")
  const redirectUri = params.get("redirect_uri")

  if (!clientId || !redirectUri) {
    throw new AgentLoginError(
      "Agent login handles require OAuth login context.",
      "invalid_oauth_context",
    )
  }

  return { clientId, redirectUri }
}

function buildOAuthContinuationURL(oauthQuery: string | undefined) {
  if (!oauthQuery) return undefined

  const params = new URLSearchParams(oauthQuery)
  const prompt = params.get("prompt")
  if (prompt) {
    const remainingPrompts = prompt
      .split(/\s+/)
      .filter((value) => value !== "login" && value !== "select_account")
    params.delete("prompt")
    if (remainingPrompts.length > 0) {
      params.set("prompt", remainingPrompts.join(" "))
    }
  }

  return `/api/auth/oauth2/authorize?${params.toString()}`
}

function normalizeHandle(value: string) {
  return value.trim().toLowerCase()
}

function isRedeemableEnvironment(kind: string) {
  return kind === "LOCAL" || kind === "PREVIEW"
}

function resolveTtlSeconds(ttlSeconds: number | undefined) {
  if (!ttlSeconds) return DEFAULT_HANDLE_TTL_SECONDS
  return Math.min(Math.max(60, Math.floor(ttlSeconds)), MAX_HANDLE_TTL_SECONDS)
}

function generateHandle(clientId: string) {
  const label = slugifyClientId(clientId)
  return `agent+${label}.${randomBytes(16).toString("hex")}@${AGENT_LOGIN_HANDLE_DOMAIN}`
}

function slugifyClientId(clientId: string) {
  let label = ""
  let pendingSeparator = false

  for (const character of clientId.toLowerCase()) {
    if (label.length >= 32) break

    const code = character.charCodeAt(0)
    const isAlphaNumeric =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
    if (isAlphaNumeric) {
      if (pendingSeparator && label.length > 0 && label.length < 31) {
        label += "-"
      }
      if (label.length >= 32) break
      label += character
      pendingSeparator = false
    } else if (label.length > 0) {
      pendingSeparator = true
    }
  }

  return label || "client"
}

async function auditAgentLoginEvent(
  prisma: AuthPrisma,
  input: {
    eventType: string
    severity?: "info" | "warning" | "critical"
    actorUserId?: string | null
    appId?: string | null
    subject?: string | null
    ipAddress?: string | null
    userAgent?: string | null
    metadata?: Record<string, unknown>
  },
) {
  await prisma.authAuditEvent.create({
    data: buildAuditEvent(input),
  })
}
