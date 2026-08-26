import {
  firstParam,
  resolveRequestingAppName,
  toOAuthQuery,
  type LoginSearchParams,
} from "@/app/login/login-page-data"
import { getAuthBaseUrl, getAuthCustomAudiences, env } from "@/config/env"
import { prisma } from "@/db/client"
import { FIRST_PARTY_APP_SEEDS } from "@/domain/apps"
import {
  createOAuthResourceCatalog,
  resolveOAuthResource,
} from "@/domain/oauth-resources"
import { describeScopes, isKnownScope } from "@/domain/scopes"

import { OAuthConsentPageClient } from "./consent-page-client"

type OAuthConsentPageProps = {
  searchParams?: Promise<LoginSearchParams>
}

const oauthResourceCatalog = createOAuthResourceCatalog({
  authIssuer: getAuthBaseUrl(),
  customAudiences: getAuthCustomAudiences(),
})
const firstPartyClientIds = new Set(
  FIRST_PARTY_APP_SEEDS.flatMap((app) =>
    app.environments.flatMap((environment) => [
      environment.clientId,
      ...(environment.managerSessionServiceClientId
        ? [environment.managerSessionServiceClientId]
        : []),
    ]),
  ),
)

export default async function OAuthConsentPage({
  searchParams,
}: OAuthConsentPageProps = {}) {
  const params = (await searchParams) ?? {}
  const requestedScopes = parseRequestedScopes(firstParam(params.scope))
  const knownScopes = requestedScopes.filter(isKnownScope)
  const describedScopes = describeScopes(knownScopes)
  const describedScopeKeys = new Set<string>(
    describedScopes.map((scope) => scope.key),
  )
  const unknownScopes = requestedScopes.filter(
    (scope) => !describedScopeKeys.has(scope),
  )
  const clientId = firstParam(params.client_id)
  const target = resolveConsentTarget(params.resource)
  const unverifiedDynamicClient =
    target != null && clientId != null && !firstPartyClientIds.has(clientId)
  const requestingAppName =
    (unverifiedDynamicClient
      ? await resolveDynamicClientName(clientId)
      : await resolveRequestingAppName(clientId)) ?? "this application"

  return (
    <OAuthConsentPageClient
      oauthQuery={toOAuthQuery(params)}
      requestingAppName={requestingAppName}
      scopes={[
        ...describedScopes,
        ...unknownScopes.map((scope) => ({
          key: scope,
          label: scope,
          description: "Requested by the application.",
        })),
      ]}
      target={target}
      unverifiedDynamicClient={unverifiedDynamicClient}
    />
  )
}

function parseRequestedScopes(value: string | undefined) {
  return [...new Set(value?.split(/\s+/).filter(Boolean) ?? [])]
}

function resolveConsentTarget(value: string | string[] | undefined) {
  const resources = Array.isArray(value) ? value : value ? [value] : []
  if (resources.length !== 1) return undefined
  const target = resolveOAuthResource(oauthResourceCatalog, resources[0])
  if (
    !target ||
    (target.resourceClass !== "admin-mcp" &&
      target.resourceClass !== "changelog-mcp") ||
    target.trustedEnvironment == null
  ) {
    return undefined
  }
  return {
    environment:
      target.trustedEnvironment[0].toUpperCase() +
      target.trustedEnvironment.slice(1),
    product:
      target.resourceClass === "admin-mcp" ? "Forge Admin MCP" : "Changelog",
    resource: target.identifier,
  }
}

async function resolveDynamicClientName(clientId: string | undefined) {
  if (!clientId || !env.DATABASE_URL) return null
  try {
    return (
      (
        await prisma.oauthClient.findUnique({
          where: { clientId },
          select: { name: true },
        })
      )?.name ?? null
    )
  } catch {
    return null
  }
}
