import {
  ADMIN_MCP_APP_KEY,
  ADMIN_MCP_APP_SEED,
  ADMIN_MCP_DEFAULT_SCOPES,
  CHANGELOG_APP_KEY,
  CHANGELOG_APP_SEED,
  CHANGELOG_DEFAULT_SCOPES,
  MANAGER_APP_KEY,
  MANAGER_APP_SEED,
  type AppEnvironmentSeed,
} from "./apps"
import { AUTH_SCOPES, type AuthScopeKey } from "./scopes"

export type OAuthResourceClass =
  | "admin-mcp"
  | "changelog-mcp"
  | "manager-session"
  | "auth-issuer"
  | "custom-audience"

export type OAuthResourceDcrExposure = "public" | "protected"

export type OAuthResourcePolicy = {
  identifier: string
  resourceClass: OAuthResourceClass
  trustedProduct: "admin" | "changelog" | "manager" | null
  trustedApp: string | null
  trustedEnvironment: AppEnvironmentSeed["kind"] | null
  allowedScopes: readonly AuthScopeKey[]
  dcrExposure: OAuthResourceDcrExposure
}

type OAuthResourceCatalogInput = {
  authIssuer: string
  customAudiences: readonly string[]
}

const compatibilityScopes = AUTH_SCOPES.map(({ key }) => key)

function mcpResourcePolicies(input: {
  app: typeof ADMIN_MCP_APP_SEED | typeof CHANGELOG_APP_SEED
  resourceClass: "admin-mcp" | "changelog-mcp"
  trustedProduct: "admin" | "changelog"
  trustedApp: typeof ADMIN_MCP_APP_KEY | typeof CHANGELOG_APP_KEY
  allowedScopes: readonly AuthScopeKey[]
}): OAuthResourcePolicy[] {
  return input.app.environments.flatMap((environment) =>
    environment.mcpResourceAudience
      ? [
          {
            identifier: environment.mcpResourceAudience,
            resourceClass: input.resourceClass,
            trustedProduct: input.trustedProduct,
            trustedApp: input.trustedApp,
            trustedEnvironment: environment.kind,
            allowedScopes: input.allowedScopes,
            dcrExposure: "public" as const,
          },
        ]
      : [],
  )
}

function managerSessionResourcePolicies(): OAuthResourcePolicy[] {
  return MANAGER_APP_SEED.environments.flatMap((environment) =>
    environment.managerSessionServiceAudience
      ? [
          {
            identifier: environment.managerSessionServiceAudience,
            resourceClass: "manager-session" as const,
            trustedProduct: "manager" as const,
            trustedApp: MANAGER_APP_KEY,
            trustedEnvironment: environment.kind,
            allowedScopes: ["admin:manager-session:validate"] as const,
            dcrExposure: "protected" as const,
          },
        ]
      : [],
  )
}

/**
 * Builds the provider's complete protected-resource policy without consulting
 * database state. First-party client trust remains owned by the app seed
 * registry; this catalogue describes targets, not clients.
 */
export function createOAuthResourceCatalog({
  authIssuer,
  customAudiences,
}: OAuthResourceCatalogInput): OAuthResourcePolicy[] {
  const catalogue = new Map<string, OAuthResourcePolicy>()
  const add = (policy: OAuthResourcePolicy) => {
    if (!catalogue.has(policy.identifier))
      catalogue.set(policy.identifier, policy)
  }

  mcpResourcePolicies({
    app: ADMIN_MCP_APP_SEED,
    resourceClass: "admin-mcp",
    trustedProduct: "admin",
    trustedApp: ADMIN_MCP_APP_KEY,
    allowedScopes: ADMIN_MCP_DEFAULT_SCOPES,
  }).forEach(add)
  mcpResourcePolicies({
    app: CHANGELOG_APP_SEED,
    resourceClass: "changelog-mcp",
    trustedProduct: "changelog",
    trustedApp: CHANGELOG_APP_KEY,
    allowedScopes: CHANGELOG_DEFAULT_SCOPES,
  }).forEach(add)
  managerSessionResourcePolicies().forEach(add)

  add({
    identifier: authIssuer,
    resourceClass: "auth-issuer",
    trustedProduct: null,
    trustedApp: null,
    trustedEnvironment: null,
    allowedScopes: compatibilityScopes,
    dcrExposure: "protected",
  })

  customAudiences.forEach((identifier) =>
    add({
      identifier,
      resourceClass: "custom-audience",
      trustedProduct: null,
      trustedApp: null,
      trustedEnvironment: null,
      allowedScopes: compatibilityScopes,
      dcrExposure: "protected",
    }),
  )

  return [...catalogue.values()]
}

export function getPublicDcrResources(
  catalogue: readonly OAuthResourcePolicy[],
): string[] {
  return catalogue
    .filter(({ dcrExposure }) => dcrExposure === "public")
    .map(({ identifier }) => identifier)
}

export function getPublicDcrAllowedScopes(
  catalogue: readonly OAuthResourcePolicy[],
): AuthScopeKey[] {
  return Array.from(
    new Set(
      catalogue
        .filter(({ dcrExposure }) => dcrExposure === "public")
        .flatMap(({ allowedScopes }) => allowedScopes),
    ),
  )
}

export function resolveOAuthResource(
  catalogue: readonly OAuthResourcePolicy[],
  identifier: string,
): OAuthResourcePolicy | undefined {
  return catalogue.find((resource) => resource.identifier === identifier)
}
