export const AUTH_SCOPES = [
  {
    key: "openid",
    label: "Sign you in",
    description: "Confirm your identity for the requesting application.",
  },
  {
    key: "profile:read",
    label: "Read your profile",
    description: "Share your name, profile image, and Jesus Film account id.",
  },
  {
    key: "email:read",
    label: "Read your email address",
    description: "Share your verified email address.",
  },
  {
    key: "membership:read",
    label: "Read membership status",
    description:
      "Share whether your Jesus Film account can use first-party apps.",
  },
  {
    key: "admin:access",
    label: "Access Admin",
    description: "Allow sign-in to the Jesus Film Admin application.",
  },
  {
    key: "admin:content:read",
    label: "Read Admin content",
    description: "Allow Admin to read editorial content on your behalf.",
  },
  {
    key: "admin:content:write",
    label: "Write Admin content",
    description: "Allow Admin to change editorial content on your behalf.",
  },
  {
    key: "tokens:manage",
    label: "Manage tokens",
    description: "Create, inspect, and revoke scoped Auth tokens.",
  },
] as const

export type AuthScopeKey = (typeof AUTH_SCOPES)[number]["key"]

const scopeKeys = new Set(AUTH_SCOPES.map((scope) => scope.key))

export function isKnownScope(scope: string): scope is AuthScopeKey {
  return scopeKeys.has(scope as AuthScopeKey)
}

export function assertKnownScopes(scopes: readonly string[]): AuthScopeKey[] {
  const unknownScopes = scopes.filter((scope) => !isKnownScope(scope))

  if (unknownScopes.length > 0) {
    throw new Error(`Unknown Auth scope(s): ${unknownScopes.join(", ")}`)
  }

  return [...new Set(scopes)] as AuthScopeKey[]
}

export function describeScopes(scopes: readonly string[]) {
  const requested = new Set(assertKnownScopes(scopes))

  return AUTH_SCOPES.filter((scope) => requested.has(scope.key))
}
