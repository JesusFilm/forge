import {
  STUDIO_MCP_APP_SEED,
  STUDIO_MCP_RESOURCE_SCOPES,
  ADMIN_APP_SEED,
  ADMIN_MCP_APP_KEY,
  ADMIN_MCP_APP_SEED,
  ADMIN_MCP_DEFAULT_SCOPES,
  CHANGELOG_APP_KEY,
  CHANGELOG_APP_SEED,
  CHANGELOG_DEFAULT_SCOPES,
  MANAGER_APP_KEY,
  MANAGER_APP_SEED,
  WEB_APP_KEY,
  WEB_APP_SEED,
  WEB_DEFAULT_SCOPES,
  type AppEnvironmentSeed,
} from "./apps"
import { AUTH_SCOPES, type AuthScopeKey } from "./scopes"

export type OAuthResourceClass =
  | "shorts-mcp"
  | "admin-mcp"
  | "changelog-mcp"
  | "manager-session"
  | "watch-user-data"
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
 * Admin GraphQL as an audience for the signed-in viewer's own Watch data.
 * Derived from the Admin registry (not AUTH_VALID_AUDIENCES) so it can never
 * be widened by configuration, and bound to Web's seeded scopes so a Web
 * token minted for it carries nothing Web could not already request.
 */
function watchUserDataResourcePolicies(): OAuthResourcePolicy[] {
  return ADMIN_APP_SEED.environments.map((environment) => ({
    identifier: new URL(
      "/api/graphql",
      environment.allowedOrigins[0],
    ).toString(),
    resourceClass: "watch-user-data" as const,
    trustedProduct: "admin" as const,
    trustedApp: WEB_APP_KEY,
    trustedEnvironment: environment.kind,
    allowedScopes: WEB_DEFAULT_SCOPES,
    dcrExposure: "protected" as const,
  }))
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
  watchUserDataResourcePolicies().forEach(add)
  STUDIO_MCP_APP_SEED.environments.forEach((e) =>
    add({
      identifier: e.mcpResourceAudience!,
      resourceClass: "shorts-mcp",
      trustedProduct: "manager",
      trustedApp: "shorts-mcp",
      trustedEnvironment: e.kind,
      allowedScopes: STUDIO_MCP_RESOURCE_SCOPES,
      dcrExposure: "public",
    }),
  )

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

/**
 * Authorize-time admission for a Watch user-data target: only the Web client
 * seeded for the target's own environment, and only within Web's scopes. The
 * provider still requires the per-client resource link before issuing.
 * `requestedScopes` is null when the request omits `scope`, in which case the
 * provider falls back to the client's seeded Web defaults.
 */
export function isWatchUserDataAuthorization(
  target: OAuthResourcePolicy,
  clientId: string | null,
  requestedScopes: readonly string[] | null,
): boolean {
  if (target.resourceClass !== "watch-user-data") return false
  const webClientId = WEB_APP_SEED.environments.find(
    ({ kind }) => kind === target.trustedEnvironment,
  )?.clientId
  if (!clientId || clientId !== webClientId) return false
  return (requestedScopes ?? []).every((scope) =>
    target.allowedScopes.includes(scope as AuthScopeKey),
  )
}
