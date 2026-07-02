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
    key: "manager:access",
    label: "Access Manager",
    description: "Allow sign-in to the Jesus Film Manager application.",
  },
  {
    key: "mastra-studio:access",
    label: "Access Mastra Studio",
    description: "Allow sign-in to the Mastra Studio gateway.",
  },
  {
    key: "web:watch-events:write",
    label: "Record watch activity",
    description:
      "Allow Web to record meaningful signed-in video watch activity.",
  },
  {
    key: "admin:manager-session:validate",
    label: "Validate Manager sessions",
    description:
      "Allow Manager to validate operator access against the Admin app.",
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
