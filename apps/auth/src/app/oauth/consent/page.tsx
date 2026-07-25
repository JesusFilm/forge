import {
  firstParam,
  resolveRequestingAppName,
  toOAuthQuery,
  type LoginSearchParams,
} from "@/app/login/login-page-data"
import { describeScopes, isKnownScope } from "@/domain/scopes"

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

  return (
    <OAuthConsentPageClient
      oauthQuery={toOAuthQuery(params)}
      requestingAppName={
        (await resolveRequestingAppName(firstParam(params.client_id))) ??
        "this application"
      }
      scopes={[
        ...describedScopes,
        ...unknownScopes.map((scope) => ({
          key: scope,
          label: scope,
          description: "Requested by the application.",
        })),
      ]}
    />
  )
}

function parseRequestedScopes(value: string | undefined) {
  return [...new Set(value?.split(/\s+/).filter(Boolean) ?? [])]
}
