import type { AuthScopeKey } from "./scopes"

export const FIRST_PARTY_OWNER = {
  ownerType: "jesus_film",
  ownerName: "Jesus Film Project",
  trustTier: "first_party",
} as const

export const ADMIN_APP_KEY = "admin"
export const MANAGER_APP_KEY = "manager"
export const MASTRA_STUDIO_APP_KEY = "mastra-studio"

export type AppEnvironmentSeed = {
  key: string
  kind: "local" | "preview" | "staging" | "production"
  clientId: string
  redirectUris: string[]
  postLogoutRedirectUris: string[]
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

export const MANAGER_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
  "membership:read",
  "manager:access",
] satisfies AuthScopeKey[]

export const MASTRA_STUDIO_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
  "mastra-studio:access",
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
      postLogoutRedirectUris: ["http://localhost:3003/api/auth/login"],
      allowedOrigins: ["http://localhost:3003"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "preview",
      kind: "preview",
      clientId: "jfp_admin_preview",
      redirectUris: ["https://admin-preview.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: [
        "https://admin-preview.jesusfilm.org/api/auth/login",
      ],
      allowedOrigins: ["https://admin-preview.jesusfilm.org"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "staging",
      kind: "staging",
      clientId: "jfp_admin_staging",
      redirectUris: ["https://admin-stage.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: [
        "https://admin-stage.jesusfilm.org/api/auth/login",
      ],
      allowedOrigins: ["https://admin-stage.jesusfilm.org"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_admin_production",
      redirectUris: ["https://admin.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: ["https://admin.jesusfilm.org/api/auth/login"],
      allowedOrigins: ["https://admin.jesusfilm.org"],
      defaultScopes: ADMIN_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

export const MANAGER_APP_SEED: RegisteredAppSeed = {
  key: MANAGER_APP_KEY,
  displayName: "Jesus Film Manager",
  description: "Operator surface for Jesus Film media enrichment pipelines.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: "jfp_manager_local",
      redirectUris: ["http://localhost:3002/api/auth/callback"],
      postLogoutRedirectUris: ["http://localhost:3002/login"],
      allowedOrigins: ["http://localhost:3002"],
      defaultScopes: MANAGER_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "preview",
      kind: "preview",
      clientId: "jfp_manager_preview",
      redirectUris: ["https://manager-preview.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: ["https://manager-preview.jesusfilm.org/login"],
      allowedOrigins: ["https://manager-preview.jesusfilm.org"],
      defaultScopes: MANAGER_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "staging",
      kind: "staging",
      clientId: "jfp_manager_staging",
      redirectUris: ["https://manager-stage.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: ["https://manager-stage.jesusfilm.org/login"],
      allowedOrigins: ["https://manager-stage.jesusfilm.org"],
      defaultScopes: MANAGER_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_manager_production",
      redirectUris: ["https://manager.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: ["https://manager.jesusfilm.org/login"],
      allowedOrigins: ["https://manager.jesusfilm.org"],
      defaultScopes: MANAGER_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

export const MASTRA_STUDIO_APP_SEED: RegisteredAppSeed = {
  key: MASTRA_STUDIO_APP_KEY,
  displayName: "Jesus Film Mastra Studio",
  description: "Forge-authenticated gateway for Mastra Studio workflow agents.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: "jfp_mastra_studio_local",
      redirectUris: ["http://localhost:3005/api/auth/callback"],
      postLogoutRedirectUris: ["http://localhost:3005/api/auth/login"],
      allowedOrigins: ["http://localhost:3005"],
      defaultScopes: MASTRA_STUDIO_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "preview",
      kind: "preview",
      clientId: "jfp_mastra_studio_preview",
      redirectUris: [
        "https://forge-mastra-studio.up.railway.app/api/auth/callback",
      ],
      postLogoutRedirectUris: [
        "https://forge-mastra-studio.up.railway.app/api/auth/login",
      ],
      allowedOrigins: ["https://forge-mastra-studio.up.railway.app"],
      defaultScopes: MASTRA_STUDIO_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "staging",
      kind: "staging",
      clientId: "jfp_mastra_studio_staging",
      redirectUris: [
        "https://mastra-studio-stage.jesusfilm.org/api/auth/callback",
      ],
      postLogoutRedirectUris: [
        "https://mastra-studio-stage.jesusfilm.org/api/auth/login",
      ],
      allowedOrigins: ["https://mastra-studio-stage.jesusfilm.org"],
      defaultScopes: MASTRA_STUDIO_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_mastra_studio_production",
      redirectUris: ["https://mastra-studio.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: [
        "https://mastra-studio.jesusfilm.org/api/auth/login",
      ],
      allowedOrigins: ["https://mastra-studio.jesusfilm.org"],
      defaultScopes: MASTRA_STUDIO_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

export const FIRST_PARTY_APP_SEEDS = [
  ADMIN_APP_SEED,
  MANAGER_APP_SEED,
  MASTRA_STUDIO_APP_SEED,
] satisfies RegisteredAppSeed[]
