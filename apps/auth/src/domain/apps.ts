import type { AuthScopeKey } from "./scopes"

export const FIRST_PARTY_OWNER = {
  ownerType: "jesus_film",
  ownerName: "Jesus Film Project",
  trustTier: "first_party",
} as const

export const ADMIN_APP_KEY = "admin"

export type AppEnvironmentSeed = {
  key: string
  kind: "local" | "preview" | "staging" | "production"
  clientId: string
  redirectUris: string[]
  allowedOrigins: string[]
  defaultScopes: AuthScopeKey[]
  autoApprove: boolean
}

export type RegisteredAppSeed = {
  key: string
  displayName: string
  description: string
  trustTier: typeof FIRST_PARTY_OWNER.trustTier
  ownerType: typeof FIRST_PARTY_OWNER.ownerType
  ownerName: typeof FIRST_PARTY_OWNER.ownerName
  environments: AppEnvironmentSeed[]
}

export const ADMIN_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
  "membership:read",
  "admin:access",
] satisfies AuthScopeKey[]

export const ADMIN_APP_SEED: RegisteredAppSeed = {
  key: ADMIN_APP_KEY,
  displayName: "Jesus Film Admin",
  description: "Editorial administration surface for Jesus Film content.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: "jfp_admin_local",
      redirectUris: ["http://localhost:3003/api/auth/callback"],
      allowedOrigins: ["http://localhost:3003"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "preview",
      kind: "preview",
      clientId: "jfp_admin_preview",
      redirectUris: ["https://admin-preview.jesusfilm.org/api/auth/callback"],
      allowedOrigins: ["https://admin-preview.jesusfilm.org"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "staging",
      kind: "staging",
      clientId: "jfp_admin_staging",
      redirectUris: ["https://admin-stage.jesusfilm.org/api/auth/callback"],
      allowedOrigins: ["https://admin-stage.jesusfilm.org"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_admin_production",
      redirectUris: ["https://admin.jesusfilm.org/api/auth/callback"],
      allowedOrigins: ["https://admin.jesusfilm.org"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}
