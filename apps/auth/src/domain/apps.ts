import type { AuthScopeKey } from "./scopes"

export const FIRST_PARTY_OWNER = {
  ownerType: "jesus_film",
  ownerName: "Jesus Film Project",
  trustTier: "first_party",
} as const

export const ADMIN_APP_KEY = "admin"
export const MANAGER_APP_KEY = "manager"
export const MASTRA_STUDIO_APP_KEY = "mastra-studio"
export const WEB_APP_KEY = "web"
export const CHAT_APP_KEY = "chat"
export const ADMIN_MCP_APP_KEY = "admin-mcp"
export const ADMIN_MCP_CODEX_CLIENT_ID = "jfp_admin_mcp_codex"
export const MOBILE_APP_KEY = "mobile"
export const MOBILE_LOCAL_CLIENT_ID = "jfp_mobile_local"
export const MOBILE_PRODUCTION_CLIENT_ID = "jfp_mobile_production"

export type AppEnvironmentSeed = {
  key: string
  kind: "local" | "preview" | "staging" | "production"
  clientId: string
  managerSessionServiceClientId?: string
  managerSessionServiceAudience?: string
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

export const WEB_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
  "web:watch-events:write",
] satisfies AuthScopeKey[]

// Identity-only: chat performs no authorization, so no *:access or
// membership:read (feat-207 R7).
export const CHAT_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
] satisfies AuthScopeKey[]

// Identity-only: mobile's watch-progress permissions ride admin's MOBILE_USER
// principal (JWKS-verified user JWT), not OAuth scopes.
export const MOBILE_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
] satisfies AuthScopeKey[]

// experience:create / experience:generate are experience-level primitives
// (feat-320); generate spends paid AI tokens so it stays a separate,
// independently revocable scope. Neither implies experience:publish.
export const ADMIN_MCP_DEFAULT_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
  "offline_access",
  "membership:read",
  "experience:read",
  "experience:locale:create",
  "experience:locale:update",
  "experience:locale:validate",
  "media:read",
  "video:read",
  "bible:read",
  "experience:publish",
  "experience:create",
  "experience:generate",
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
      managerSessionServiceClientId: "jfp_manager_local_session_service",
      managerSessionServiceAudience:
        "http://localhost:3003/api/manager/session",
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
      managerSessionServiceClientId: "jfp_manager_preview_session_service",
      managerSessionServiceAudience:
        "https://admin-preview.jesusfilm.org/api/manager/session",
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
      managerSessionServiceClientId: "jfp_manager_staging_session_service",
      managerSessionServiceAudience:
        "https://admin-stage.jesusfilm.org/api/manager/session",
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
      managerSessionServiceClientId: "jfp_manager_production_session_service",
      managerSessionServiceAudience:
        "https://admin.jesusfilm.org/api/manager/session",
      redirectUris: ["https://manager.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: ["https://manager.jesusfilm.org/login"],
      allowedOrigins: ["https://manager.jesusfilm.org"],
      defaultScopes: MANAGER_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

export const WEB_APP_SEED: RegisteredAppSeed = {
  key: WEB_APP_KEY,
  displayName: "Jesus Film Web",
  description: "Public Jesus Film watch experience.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: "jfp_web_local",
      redirectUris: ["http://localhost:3000/watch/api/auth/callback"],
      postLogoutRedirectUris: ["http://localhost:3000/watch"],
      allowedOrigins: ["http://localhost:3000"],
      defaultScopes: WEB_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "preview",
      kind: "preview",
      clientId: "jfp_web_preview",
      redirectUris: [
        "https://web-preview.jesusfilm.org/watch/api/auth/callback",
      ],
      postLogoutRedirectUris: ["https://web-preview.jesusfilm.org/watch"],
      allowedOrigins: ["https://web-preview.jesusfilm.org"],
      defaultScopes: WEB_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "staging",
      kind: "staging",
      clientId: "jfp_web_staging",
      redirectUris: ["https://web-stage.jesusfilm.org/watch/api/auth/callback"],
      postLogoutRedirectUris: ["https://web-stage.jesusfilm.org/watch"],
      allowedOrigins: ["https://web-stage.jesusfilm.org"],
      defaultScopes: WEB_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_web_production",
      redirectUris: [
        "https://www.jesusfilm.org/watch/api/auth/callback",
        "https://watch.jesusfilm.org/watch/api/auth/callback",
      ],
      postLogoutRedirectUris: [
        "https://www.jesusfilm.org/watch",
        "https://watch.jesusfilm.org/watch",
      ],
      allowedOrigins: [
        "https://www.jesusfilm.org",
        "https://watch.jesusfilm.org",
      ],
      defaultScopes: WEB_DEFAULT_SCOPES,
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
        "https://forgemastra-gateway.up.railway.app/api/auth/callback",
      ],
      postLogoutRedirectUris: [
        "https://forgemastra-gateway.up.railway.app/api/auth/login",
      ],
      allowedOrigins: ["https://forgemastra-gateway.up.railway.app"],
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
      redirectUris: ["https://mastra.jesusfilm.org/api/auth/callback"],
      postLogoutRedirectUris: ["https://mastra.jesusfilm.org/api/auth/login"],
      allowedOrigins: ["https://mastra.jesusfilm.org"],
      defaultScopes: MASTRA_STUDIO_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

// Local + production: production is the Cloudflare-fronted chat.jesusfilm.ai.
// A host change is a seed edit + merge — it re-seeds on deploy; keep the same
// clientId (the seeder never prunes; see
// docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md).
// Redirect URIs must be exact-match per environment.
export const CHAT_APP_SEED: RegisteredAppSeed = {
  key: CHAT_APP_KEY,
  displayName: "Jesus Film Chat",
  description: "Conversational AI chat surface.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: "jfp_chat_local",
      redirectUris: ["http://localhost:3200/api/auth/callback"],
      postLogoutRedirectUris: ["http://localhost:3200"],
      allowedOrigins: ["http://localhost:3200"],
      defaultScopes: CHAT_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_chat_production",
      redirectUris: ["https://chat.jesusfilm.ai/api/auth/callback"],
      postLogoutRedirectUris: ["https://chat.jesusfilm.ai"],
      allowedOrigins: ["https://chat.jesusfilm.ai"],
      defaultScopes: CHAT_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

export const ADMIN_MCP_APP_SEED: RegisteredAppSeed = {
  key: ADMIN_MCP_APP_KEY,
  displayName: "Jesus Film Admin MCP",
  description:
    "OAuth client for AI-assisted Admin operations, including Experience locale creation and publishing.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: "jfp_admin_mcp_local",
      redirectUris: ["http://localhost:3003/mcp/oauth/callback"],
      postLogoutRedirectUris: ["http://localhost:3003/dashboard/experiences"],
      allowedOrigins: ["http://localhost:3003"],
      defaultScopes: ADMIN_MCP_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "preview",
      kind: "preview",
      clientId: "jfp_admin_mcp_preview",
      redirectUris: ["https://admin-preview.jesusfilm.org/mcp/oauth/callback"],
      postLogoutRedirectUris: [
        "https://admin-preview.jesusfilm.org/dashboard/experiences",
      ],
      allowedOrigins: ["https://admin-preview.jesusfilm.org"],
      defaultScopes: ADMIN_MCP_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "staging",
      kind: "staging",
      clientId: "jfp_admin_mcp_staging",
      redirectUris: ["https://admin-stage.jesusfilm.org/mcp/oauth/callback"],
      postLogoutRedirectUris: [
        "https://admin-stage.jesusfilm.org/dashboard/experiences",
      ],
      allowedOrigins: ["https://admin-stage.jesusfilm.org"],
      defaultScopes: ADMIN_MCP_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: "jfp_admin_mcp_production",
      redirectUris: ["https://admin.jesusfilm.org/mcp/oauth/callback"],
      postLogoutRedirectUris: [
        "https://admin.jesusfilm.org/dashboard/experiences",
      ],
      allowedOrigins: ["https://admin.jesusfilm.org"],
      defaultScopes: ADMIN_MCP_DEFAULT_SCOPES,
      autoApprove: true,
    },
    // Codex MCP uses a loopback OAuth callback with an ephemeral port. The
    // dynamic redirect hook admits exact callback URLs only for this client id.
    {
      key: "codex",
      kind: "production",
      clientId: ADMIN_MCP_CODEX_CLIENT_ID,
      redirectUris: [],
      postLogoutRedirectUris: [],
      allowedOrigins: [],
      defaultScopes: ADMIN_MCP_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

// Mobile's hosted-page fallback runs as a self-RP flow: Auth (via the jfp
// generic-oauth provider) is the OAuth client toward its own oauth-provider,
// so the redirect URIs are Auth's own https callback — the forgemobile://
// scheme never appears at the OAuth layer, only in trusted origins. The
// server-side exchange means no secret ships in the app; the client stays
// public + PKCE like every other first-party seed.
export const MOBILE_APP_SEED: RegisteredAppSeed = {
  key: MOBILE_APP_KEY,
  displayName: "Jesus Film Watch",
  description: "Jesus Film mobile watch experience.",
  ...FIRST_PARTY_OWNER,
  environments: [
    {
      key: "local",
      kind: "local",
      clientId: MOBILE_LOCAL_CLIENT_ID,
      redirectUris: ["http://localhost:3004/api/auth/oauth2/callback/jfp"],
      postLogoutRedirectUris: ["http://localhost:3004"],
      allowedOrigins: ["http://localhost:3004"],
      defaultScopes: MOBILE_DEFAULT_SCOPES,
      autoApprove: true,
    },
    {
      key: "production",
      kind: "production",
      clientId: MOBILE_PRODUCTION_CLIENT_ID,
      redirectUris: ["https://auth.jesusfilm.org/api/auth/oauth2/callback/jfp"],
      postLogoutRedirectUris: ["https://auth.jesusfilm.org"],
      allowedOrigins: ["https://auth.jesusfilm.org"],
      defaultScopes: MOBILE_DEFAULT_SCOPES,
      autoApprove: true,
    },
  ],
}

export const FIRST_PARTY_APP_SEEDS = [
  ADMIN_APP_SEED,
  MANAGER_APP_SEED,
  WEB_APP_SEED,
  MASTRA_STUDIO_APP_SEED,
  CHAT_APP_SEED,
  ADMIN_MCP_APP_SEED,
  MOBILE_APP_SEED,
] satisfies RegisteredAppSeed[]
