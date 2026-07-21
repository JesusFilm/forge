import {
  ADMIN_MCP_CODEX_CLIENT_ID,
  FIRST_PARTY_APP_SEEDS,
  type RegisteredAppSeed,
} from "@/domain/apps"
import { assertKnownScopes } from "@/domain/scopes"

export type AppEnvironmentPolicyInput = {
  clientId?: string
  kind: "local" | "preview" | "staging" | "production"
  status: "pending" | "approved" | "rejected" | "revoked"
  autoApprove: boolean
  redirectUris: readonly string[]
  allowedOrigins: readonly string[]
  defaultScopes: readonly string[]
}

export function isExactRedirectUriAllowed(
  redirectUri: string,
  allowedRedirectUris: readonly string[],
) {
  return allowedRedirectUris.some((allowedRedirectUri) => {
    return allowedRedirectUri === redirectUri
  })
}

export function requiresProductionApproval(input: AppEnvironmentPolicyInput) {
  return input.kind === "production" && input.status !== "approved"
}

export function validateAppEnvironmentPolicy(input: AppEnvironmentPolicyInput) {
  if (
    input.redirectUris.length === 0 &&
    input.clientId !== ADMIN_MCP_CODEX_CLIENT_ID
  ) {
    throw new Error("App environment must define at least one redirect URI.")
  }

  if (
    input.allowedOrigins.length === 0 &&
    input.clientId !== ADMIN_MCP_CODEX_CLIENT_ID
  ) {
    throw new Error("App environment must define at least one allowed origin.")
  }

  assertKnownScopes(input.defaultScopes)

  if (requiresProductionApproval(input)) {
    throw new Error("Production app environments must be approved before use.")
  }
}

export function getFirstPartyAppSeeds(): RegisteredAppSeed[] {
  return [...FIRST_PARTY_APP_SEEDS]
}
