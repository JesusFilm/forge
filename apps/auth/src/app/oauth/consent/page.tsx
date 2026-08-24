import {
  firstParam,
  resolveRequestingAppName,
  toOAuthQuery,
  type LoginSearchParams,
} from "@/app/login/login-page-data"
import { describeScopes, isKnownScope } from "@/domain/scopes"
import { prisma } from "@/db/client"
import {
  CHANGELOG_LOCAL_CLIENT_ID,
  CHANGELOG_PRODUCTION_CLIENT_ID,
} from "@/domain/apps"
import { resolveChangelogOAuthTarget } from "@/services/oauth-policy.service"

import { OAuthConsentPageClient } from "./consent-page-client"

type OAuthConsentPageProps = {
  searchParams?: Promise<LoginSearchParams>
}

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
  const target = resolveChangelogTarget(params.resource)
  const unverifiedDynamicClient =
    target != null &&
    clientId !== CHANGELOG_LOCAL_CLIENT_ID &&
    clientId !== CHANGELOG_PRODUCTION_CLIENT_ID
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

function resolveChangelogTarget(value: string | string[] | undefined) {
  const resources = Array.isArray(value) ? value : value ? [value] : []
  const target = resolveChangelogOAuthTarget({
    seededEnvironmentKind: null,
    resources,
  })
  if (!target.allowed || target.resource == null) return undefined
  return {
    environment: target.environmentKind === "local" ? "Local" : "Production",
    resource: target.resource,
  }
}

async function resolveDynamicClientName(clientId: string | undefined) {
  if (!clientId || !process.env.DATABASE_URL) return null
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
