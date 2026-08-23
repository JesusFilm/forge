import {
  assertTokenPolicy,
  type TokenPolicyInput,
} from "./token-policy.service"

export type OAuthPolicyInput = TokenPolicyInput & {
  membershipStatus?: "invited" | "active" | "suspended" | "disabled" | null
  appStatus: "active" | "suspended" | "archived"
  environmentStatus: "pending" | "approved" | "rejected" | "revoked"
  grantStatus: "pending" | "approved" | "rejected" | "revoked"
}

export type OAuthTokenDecision = {
  audience: string
  scopes: string[]
  family: TokenPolicyInput["family"]
}

export const CHANGELOG_OAUTH_SCOPES = [
  "changelog:read",
  "changelog:submit",
  "changelog:admin",
] as const

export const CHANGELOG_OAUTH_RESOURCES = {
  local: "http://localhost:3000/mcp",
  production: "https://changelog.jesusfilm.org/mcp",
} as const

export type ChangelogEnvironmentKind = keyof typeof CHANGELOG_OAUTH_RESOURCES
export type ChangelogOAuthLifecycle = "authorization" | "exchange" | "refresh"

type ChangelogPolicyDenial = {
  allowed: false
  reason:
    | "changelog_access_denied"
    | "changelog_grant_changed"
    | "invalid_changelog_target"
}

export type ChangelogScopeDecision =
  | { allowed: true; scopes: string[] }
  | ChangelogPolicyDenial

export type ChangelogTargetDecision =
  | {
      allowed: true
      dynamicClient: boolean
      environmentKind: ChangelogEnvironmentKind
      resource: string | null
    }
  | ChangelogPolicyDenial

const changelogScopeSet = new Set<string>(CHANGELOG_OAUTH_SCOPES)

export function resolveChangelogOAuthTarget(input: {
  seededEnvironmentKind: ChangelogEnvironmentKind | null
  resources: readonly string[]
}): ChangelogTargetDecision {
  const { seededEnvironmentKind, resources } = input

  if (seededEnvironmentKind) {
    if (resources.length === 0) {
      return {
        allowed: true,
        dynamicClient: false,
        environmentKind: seededEnvironmentKind,
        resource: null,
      }
    }
    if (
      resources.length !== 1 ||
      resources[0] !== CHANGELOG_OAUTH_RESOURCES[seededEnvironmentKind]
    ) {
      return { allowed: false, reason: "invalid_changelog_target" }
    }
    return {
      allowed: true,
      dynamicClient: false,
      environmentKind: seededEnvironmentKind,
      resource: resources[0],
    }
  }

  if (resources.length !== 1) {
    return { allowed: false, reason: "invalid_changelog_target" }
  }

  const resource = resources[0]
  const target = Object.entries(CHANGELOG_OAUTH_RESOURCES).find(
    ([, expected]) => resource === expected,
  )
  if (!target) return { allowed: false, reason: "invalid_changelog_target" }

  return {
    allowed: true,
    dynamicClient: true,
    environmentKind: target[0] as ChangelogEnvironmentKind,
    resource,
  }
}

export function decideChangelogOAuthScopes(input: {
  lifecycle: ChangelogOAuthLifecycle
  requestedScopes: readonly string[]
  grantedScopes: readonly string[]
  scopeCeiling?: readonly string[]
  environmentKind: ChangelogEnvironmentKind
  dynamicClient: boolean
  productionEnabled: boolean
}): ChangelogScopeDecision {
  const requestedScopes = [...new Set(input.requestedScopes)]
  const ceiling =
    input.lifecycle === "authorization"
      ? requestedScopes
      : input.scopeCeiling == null
        ? null
        : [...new Set(input.scopeCeiling)]
  if (!ceiling) return { allowed: false, reason: "changelog_access_denied" }

  const grantedScopes = expandChangelogGrantScopes(input.grantedScopes)
  if (input.environmentKind === "production" && !input.productionEnabled) {
    grantedScopes.clear()
  }

  if (input.lifecycle !== "authorization") {
    const grantChanged = ceiling.some(
      (scope) => changelogScopeSet.has(scope) && !grantedScopes.has(scope),
    )
    if (grantChanged) {
      return { allowed: false, reason: "changelog_grant_changed" }
    }
  }

  const ceilingSet = new Set(ceiling)
  const scopes = requestedScopes.filter(
    (scope) =>
      ceilingSet.has(scope) &&
      (!changelogScopeSet.has(scope) || grantedScopes.has(scope)),
  )

  if (input.dynamicClient && !scopes.includes("changelog:read")) {
    return { allowed: false, reason: "changelog_access_denied" }
  }

  return { allowed: true, scopes }
}

function expandChangelogGrantScopes(scopes: readonly string[]) {
  const granted = new Set(
    scopes.filter((scope) => changelogScopeSet.has(scope)),
  )
  if (granted.has("changelog:admin")) {
    CHANGELOG_OAUTH_SCOPES.forEach((scope) => granted.add(scope))
  } else if (granted.has("changelog:submit")) {
    granted.add("changelog:read")
  }
  return granted
}

export function authorizeOAuthTokenIssue(
  input: OAuthPolicyInput,
): OAuthTokenDecision {
  if (
    input.family === "user_delegated" &&
    input.membershipStatus !== "active"
  ) {
    throw new Error("Active membership is required for user-delegated tokens.")
  }

  if (input.appStatus !== "active") {
    throw new Error(
      `Registered app status '${input.appStatus}' cannot issue tokens.`,
    )
  }

  if (input.environmentStatus !== "approved") {
    throw new Error(
      `App environment status '${input.environmentStatus}' cannot issue tokens.`,
    )
  }

  if (input.grantStatus !== "approved") {
    throw new Error(
      `App grant status '${input.grantStatus}' cannot issue tokens.`,
    )
  }

  assertTokenPolicy(input)

  return {
    audience: input.audience,
    scopes: [...new Set(input.requestedScopes)],
    family: input.family,
  }
}
