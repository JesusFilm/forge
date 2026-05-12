import { assertKnownScopes } from "@/domain/scopes"

export type EnvironmentKind = "local" | "preview" | "staging" | "production"
export type TokenFamily = "user_delegated" | "client_credentials"

export type TokenPolicyInput = {
  family: TokenFamily
  requestedScopes: readonly string[]
  grantedScopes: readonly string[]
  environmentKind: EnvironmentKind
  audience: string
  expiresAt: Date
  now?: Date
  userId?: string | null
  serviceKey?: string | null
}

export function assertTokenPolicy(input: TokenPolicyInput) {
  const now = input.now ?? new Date()
  const requestedScopes = assertKnownScopes(input.requestedScopes)
  const grantedScopes = new Set(assertKnownScopes(input.grantedScopes))

  if (input.expiresAt <= now) {
    throw new Error("Token expiry must be in the future.")
  }

  if (
    input.environmentKind !== "production" &&
    isProductionAudience(input.audience)
  ) {
    throw new Error(
      "Non-production environments cannot request production audiences.",
    )
  }

  const missingScopes = requestedScopes.filter(
    (scope) => !grantedScopes.has(scope),
  )
  if (missingScopes.length > 0) {
    throw new Error(
      `Requested scope(s) not granted: ${missingScopes.join(", ")}`,
    )
  }

  if (input.family === "user_delegated" && !input.userId) {
    throw new Error("User-delegated tokens require a user id.")
  }

  if (input.family === "client_credentials" && !input.serviceKey) {
    throw new Error("Client-credentials tokens require a service key.")
  }
}

export function isProductionAudience(audience: string) {
  const url = new URL(audience)

  return (
    url.hostname === "jesusfilm.org" || url.hostname.endsWith(".jesusfilm.org")
  )
}
