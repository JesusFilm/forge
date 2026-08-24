import { isChangelogProductionEnabled } from "@/config/env"
import { prisma } from "@/db/client"
import { CHANGELOG_APP_KEY } from "@/domain/apps"
import {
  decideChangelogOAuthScopes,
  resolveChangelogOAuthTarget,
  type ChangelogEnvironmentKind,
  type ChangelogOAuthLifecycle,
} from "./oauth-policy.service"

type ChangelogEnvironment = {
  id: string
  kind: "LOCAL" | "PRODUCTION" | "PREVIEW" | "STAGING"
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"
  app: {
    id: string
    key: string
    status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"
  }
}

type ChangelogGrant = {
  scopes: { scope: { key: string } }[]
}

export type ChangelogOAuthGrantDependencies = {
  findClientEnvironment(clientId: string): Promise<ChangelogEnvironment | null>
  findTargetEnvironment(
    kind: ChangelogEnvironmentKind,
  ): Promise<ChangelogEnvironment | null>
  findApprovedUserGrants(input: {
    appId: string
    environmentId: string
    userId: string
  }): Promise<ChangelogGrant[]>
  productionEnabled(): boolean
}

export type ChangelogOAuthGrantInput = {
  lifecycle: ChangelogOAuthLifecycle
  userId?: string | null
  membershipStatus?: unknown
  clientId?: string | null
  requestedScopes: readonly string[]
  resources?: readonly string[] | null
  scopeCeiling?: readonly string[]
}

export type ChangelogOAuthGrantDecision =
  | {
      allowed: true
      scopes: string[]
      target: {
        dynamicClient: boolean
        environmentKind: ChangelogEnvironmentKind
        environmentId: string
        resource: string | null
      }
    }
  | {
      allowed: false
      reason:
        | "changelog_access_denied"
        | "changelog_grant_changed"
        | "invalid_changelog_target"
    }

const defaultDependencies: ChangelogOAuthGrantDependencies = {
  findClientEnvironment: (clientId) =>
    prisma.appEnvironment.findUnique({
      where: { clientId },
      select: {
        id: true,
        kind: true,
        status: true,
        app: { select: { id: true, key: true, status: true } },
      },
    }),
  findTargetEnvironment: (kind) =>
    prisma.appEnvironment.findFirst({
      where: {
        kind: kind === "local" ? "LOCAL" : "PRODUCTION",
        app: { key: CHANGELOG_APP_KEY },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        app: { select: { id: true, key: true, status: true } },
      },
    }),
  findApprovedUserGrants: ({ appId, environmentId, userId }) =>
    prisma.appGrant.findMany({
      where: {
        appId,
        environmentId,
        subjectType: "USER",
        userId,
        status: "APPROVED",
        revokedAt: null,
      },
      select: {
        scopes: { select: { scope: { select: { key: true } } } },
      },
    }),
  productionEnabled: isChangelogProductionEnabled,
}

export async function createChangelogOAuthGrantDecision(
  input: ChangelogOAuthGrantInput,
  dependencies: ChangelogOAuthGrantDependencies = defaultDependencies,
): Promise<ChangelogOAuthGrantDecision> {
  if (
    !isChangelogOAuthLifecycle(input.lifecycle) ||
    !input.userId ||
    input.membershipStatus !== "ACTIVE" ||
    !isStringArray(input.requestedScopes) ||
    (input.resources != null && !isStringArray(input.resources)) ||
    (input.scopeCeiling != null && !isStringArray(input.scopeCeiling))
  ) {
    return deny()
  }

  try {
    const clientEnvironment = input.clientId
      ? await dependencies.findClientEnvironment(input.clientId)
      : null
    if (clientEnvironment && clientEnvironment.app.key !== CHANGELOG_APP_KEY) {
      return deny()
    }

    const seededEnvironmentKind = clientEnvironment
      ? toChangelogEnvironmentKind(clientEnvironment.kind)
      : null
    if (clientEnvironment && !seededEnvironmentKind) return deny()

    const target = resolveChangelogOAuthTarget({
      seededEnvironmentKind,
      resources: input.resources ?? [],
    })
    if (!target.allowed) return target

    const environment =
      clientEnvironment ??
      (await dependencies.findTargetEnvironment(target.environmentKind))
    if (
      !environment ||
      environment.app.key !== CHANGELOG_APP_KEY ||
      environment.app.status !== "ACTIVE" ||
      environment.status !== "APPROVED" ||
      toChangelogEnvironmentKind(environment.kind) !== target.environmentKind
    ) {
      return deny()
    }

    const grants = await dependencies.findApprovedUserGrants({
      appId: environment.app.id,
      environmentId: environment.id,
      userId: input.userId,
    })
    const scopeDecision = decideChangelogOAuthScopes({
      lifecycle: input.lifecycle,
      requestedScopes: input.requestedScopes,
      grantedScopes: grants.flatMap((grant) =>
        grant.scopes.map(({ scope }) => scope.key),
      ),
      scopeCeiling: input.scopeCeiling,
      environmentKind: target.environmentKind,
      dynamicClient: target.dynamicClient,
      productionEnabled: dependencies.productionEnabled(),
    })
    if (!scopeDecision.allowed) return scopeDecision

    return {
      allowed: true,
      scopes: scopeDecision.scopes,
      target: {
        dynamicClient: target.dynamicClient,
        environmentKind: target.environmentKind,
        environmentId: environment.id,
        resource: target.resource,
      },
    }
  } catch {
    return deny()
  }
}

function toChangelogEnvironmentKind(
  kind: ChangelogEnvironment["kind"],
): ChangelogEnvironmentKind | null {
  if (kind === "LOCAL") return "local"
  if (kind === "PRODUCTION") return "production"
  return null
}

function deny(): ChangelogOAuthGrantDecision {
  return { allowed: false, reason: "changelog_access_denied" }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isChangelogOAuthLifecycle(
  value: unknown,
): value is ChangelogOAuthLifecycle {
  return (
    value === "authorization" || value === "exchange" || value === "refresh"
  )
}
