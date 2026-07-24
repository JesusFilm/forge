import { createHash } from "node:crypto"

import {
  ADMIN_MCP_DEFAULT_SCOPES,
  FIRST_PARTY_APP_SEEDS,
  type RegisteredAppSeed,
} from "@/domain/apps"
import { AUTH_SCOPES, type AuthScopeKey } from "@/domain/scopes"
import { prisma } from "@/db/client"

const MANAGER_SESSION_SCOPE = "admin:manager-session:validate"
const OFFLINE_ACCESS_SCOPE = "offline_access" satisfies AuthScopeKey
const ADMIN_MCP_DYNAMIC_SCOPE_MARKERS = ADMIN_MCP_DEFAULT_SCOPES.filter(
  (scope) => scope !== OFFLINE_ACCESS_SCOPE,
)

export async function seedFirstPartyApps() {
  for (const scope of AUTH_SCOPES) {
    await prisma.scope.upsert({
      where: { key: scope.key },
      update: {
        label: scope.label,
        description: scope.description,
      },
      create: scope,
    })
  }

  for (const appSeed of FIRST_PARTY_APP_SEEDS) {
    await seedFirstPartyApp(appSeed)
  }

  await migrateExistingDynamicAdminMcpClients()

  return {
    apps: FIRST_PARTY_APP_SEEDS.length,
    environments: FIRST_PARTY_APP_SEEDS.reduce(
      (total, app) => total + app.environments.length,
      0,
    ),
    oauthClients: FIRST_PARTY_APP_SEEDS.reduce(
      (total, app) =>
        total +
        app.environments.length +
        app.environments.filter(
          (environment) => environment.managerSessionServiceClientId,
        ).length,
      0,
    ),
    scopes: AUTH_SCOPES.length,
  }
}

async function migrateExistingDynamicAdminMcpClients() {
  const candidates = await prisma.oauthClient.findMany({
    where: {
      public: true,
      tokenEndpointAuthMethod: "none",
      grantTypes: { hasEvery: ["authorization_code", "refresh_token"] },
      scopes: { hasEvery: ADMIN_MCP_DYNAMIC_SCOPE_MARKERS },
    },
    select: {
      clientId: true,
      grantTypes: true,
      redirectUris: true,
      requirePKCE: true,
      scopes: true,
      tokenEndpointAuthMethod: true,
    },
  })

  for (const client of candidates) {
    if (!isExistingDynamicAdminMcpClientMissingOfflineAccess(client)) continue

    await prisma.oauthClient.update({
      where: { clientId: client.clientId },
      data: {
        scopes: [...client.scopes, OFFLINE_ACCESS_SCOPE],
      },
    })
  }
}

function isExistingDynamicAdminMcpClientMissingOfflineAccess(client: {
  grantTypes: string[]
  redirectUris: string[]
  requirePKCE: boolean | null
  scopes: string[]
  tokenEndpointAuthMethod: string | null
}) {
  return (
    client.tokenEndpointAuthMethod === "none" &&
    client.requirePKCE !== false &&
    client.grantTypes.includes("authorization_code") &&
    client.grantTypes.includes("refresh_token") &&
    ADMIN_MCP_DYNAMIC_SCOPE_MARKERS.every((scope) =>
      client.scopes.includes(scope),
    ) &&
    !client.scopes.includes(OFFLINE_ACCESS_SCOPE) &&
    client.redirectUris.length > 0 &&
    client.redirectUris.every(isCodexLoopbackMcpCallback)
  )
}

function isCodexLoopbackMcpCallback(redirectUri: string) {
  try {
    const url = new URL(redirectUri)
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.pathname === "/auth/callback" || url.pathname === "/callback") &&
      url.search === "" &&
      url.hash === "" &&
      url.port.length > 0
    )
  } catch {
    return false
  }
}

async function seedFirstPartyApp(appSeed: RegisteredAppSeed) {
  const app = await prisma.registeredApp.upsert({
    where: { key: appSeed.key },
    update: {
      displayName: appSeed.displayName,
      description: appSeed.description,
      trustTier: "FIRST_PARTY",
      ownerType: "JESUS_FILM",
      ownerName: appSeed.ownerName,
      status: "ACTIVE",
    },
    create: {
      key: appSeed.key,
      displayName: appSeed.displayName,
      description: appSeed.description,
      trustTier: "FIRST_PARTY",
      ownerType: "JESUS_FILM",
      ownerName: appSeed.ownerName,
      status: "ACTIVE",
    },
  })

  for (const environment of appSeed.environments) {
    await prisma.appEnvironment.upsert({
      where: {
        appId_key: {
          appId: app.id,
          key: environment.key,
        },
      },
      update: {
        kind: toEnvironmentKind(environment.kind),
        clientId: environment.clientId,
        redirectUris: environment.redirectUris,
        allowedOrigins: environment.allowedOrigins,
        defaultScopes: environment.defaultScopes,
        status: "APPROVED",
        autoApprove: environment.autoApprove,
      },
      create: {
        appId: app.id,
        key: environment.key,
        kind: toEnvironmentKind(environment.kind),
        clientId: environment.clientId,
        redirectUris: environment.redirectUris,
        allowedOrigins: environment.allowedOrigins,
        defaultScopes: environment.defaultScopes,
        status: "APPROVED",
        autoApprove: environment.autoApprove,
      },
    })

    await prisma.oauthClient.upsert({
      where: { clientId: environment.clientId },
      update: {
        name: `${appSeed.displayName} (${environment.key})`,
        redirectUris: environment.redirectUris,
        postLogoutRedirectUris: environment.postLogoutRedirectUris,
        scopes: environment.defaultScopes,
        skipConsent: environment.autoApprove,
        enableEndSession: true,
        disabled: false,
        public: true,
        requirePKCE: true,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        metadata: {
          appKey: appSeed.key,
          environmentKey: environment.key,
          environmentKind: environment.kind,
          trustTier: appSeed.trustTier,
        },
      },
      create: {
        clientId: environment.clientId,
        name: `${appSeed.displayName} (${environment.key})`,
        redirectUris: environment.redirectUris,
        postLogoutRedirectUris: environment.postLogoutRedirectUris,
        scopes: environment.defaultScopes,
        skipConsent: environment.autoApprove,
        enableEndSession: true,
        disabled: false,
        public: true,
        requirePKCE: true,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        metadata: {
          appKey: appSeed.key,
          environmentKey: environment.key,
          environmentKind: environment.kind,
          trustTier: appSeed.trustTier,
        },
      },
    })

    if (environment.managerSessionServiceClientId) {
      const clientSecret = getManagerServiceClientSecret(environment.key)
      const storedClientSecret = clientSecret
        ? hashClientSecret(clientSecret)
        : undefined

      await prisma.oauthClient.upsert({
        where: { clientId: environment.managerSessionServiceClientId },
        update: {
          name: `${appSeed.displayName} (${environment.key} session validation)`,
          redirectUris: [],
          postLogoutRedirectUris: [],
          scopes: [MANAGER_SESSION_SCOPE],
          skipConsent: true,
          enableEndSession: false,
          disabled: !storedClientSecret,
          public: false,
          requirePKCE: false,
          tokenEndpointAuthMethod: "client_secret_basic",
          grantTypes: ["client_credentials"],
          responseTypes: [],
          ...(storedClientSecret ? { clientSecret: storedClientSecret } : {}),
          metadata: {
            appKey: appSeed.key,
            environmentKey: environment.key,
            environmentKind: environment.kind,
            serviceAudience: environment.managerSessionServiceAudience,
            trustTier: appSeed.trustTier,
          },
        },
        create: {
          clientId: environment.managerSessionServiceClientId,
          name: `${appSeed.displayName} (${environment.key} session validation)`,
          redirectUris: [],
          postLogoutRedirectUris: [],
          scopes: [MANAGER_SESSION_SCOPE],
          skipConsent: true,
          enableEndSession: false,
          disabled: !storedClientSecret,
          public: false,
          requirePKCE: false,
          tokenEndpointAuthMethod: "client_secret_basic",
          grantTypes: ["client_credentials"],
          responseTypes: [],
          clientSecret: storedClientSecret,
          metadata: {
            appKey: appSeed.key,
            environmentKey: environment.key,
            environmentKind: environment.kind,
            serviceAudience: environment.managerSessionServiceAudience,
            trustTier: appSeed.trustTier,
          },
        },
      })
    }
  }
}

function getManagerServiceClientSecret(environmentKey: string) {
  return (
    process.env[
      `AUTH_MANAGER_SESSION_SERVICE_CLIENT_SECRET_${environmentKey.toUpperCase()}`
    ] ?? process.env.AUTH_MANAGER_SESSION_SERVICE_CLIENT_SECRET
  )
}

function hashClientSecret(clientSecret: string) {
  const normalizedSecret = clientSecret.startsWith("jfp_cs_")
    ? clientSecret.slice("jfp_cs_".length)
    : clientSecret

  return createHash("sha256").update(normalizedSecret).digest("base64url")
}

function toEnvironmentKind(kind: string) {
  return kind.toUpperCase() as "LOCAL" | "PREVIEW" | "STAGING" | "PRODUCTION"
}

if (process.argv[1]?.endsWith("seed-first-party-apps.ts")) {
  seedFirstPartyApps()
    .then((result) => {
      console.log(
        `Seeded ${result.apps} first-party apps, ${result.environments} environments, ${result.oauthClients} OAuth clients, and ${result.scopes} scopes.`,
      )
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
