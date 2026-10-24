import {
  ADMIN_MCP_CODEX_CLIENT_ID,
  FIRST_PARTY_APP_SEEDS,
  TV_DEVICE_CLIENT_IDS,
  type RegisteredAppSeed,
} from "@/domain/apps"
import { assertKnownScopes } from "@/domain/scopes"

// Codex MCP registers a loopback callback on an ephemeral port, so it is the
// only client that may seed with no static redirect URI. The TV clients are
// deliberately NOT here: the device grant binds a sentinel redirect URI into
// the authorization code, so a TV environment with none is a misconfiguration.
const REDIRECT_URI_EXEMPT_CLIENT_IDS = new Set<string>([
  ADMIN_MCP_CODEX_CLIENT_ID,
])

// An allowed origin only means something for a client that makes browser
// requests. Codex MCP is a loopback CLI and the TV device clients run on a
// television — neither ever issues one.
const ALLOWED_ORIGIN_EXEMPT_CLIENT_IDS = new Set<string>([
  ADMIN_MCP_CODEX_CLIENT_ID,
  ...TV_DEVICE_CLIENT_IDS,
])

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
    !isExempt(input.clientId, REDIRECT_URI_EXEMPT_CLIENT_IDS)
  ) {
    throw new Error("App environment must define at least one redirect URI.")
  }

  if (
    input.allowedOrigins.length === 0 &&
    !isExempt(input.clientId, ALLOWED_ORIGIN_EXEMPT_CLIENT_IDS)
  ) {
    throw new Error("App environment must define at least one allowed origin.")
  }

  assertKnownScopes(input.defaultScopes)

  if (requiresProductionApproval(input)) {
    throw new Error("Production app environments must be approved before use.")
  }
}

function isExempt(
  clientId: string | undefined,
  exemptions: ReadonlySet<string>,
) {
  return clientId !== undefined && exemptions.has(clientId)
}

export function getFirstPartyAppSeeds(): RegisteredAppSeed[] {
  return [...FIRST_PARTY_APP_SEEDS]
}
