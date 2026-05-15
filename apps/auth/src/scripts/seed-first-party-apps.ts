import { ADMIN_APP_SEED } from "@/domain/apps"
import { AUTH_SCOPES } from "@/domain/scopes"
import { prisma } from "@/db/client"

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

  const app = await prisma.registeredApp.upsert({
    where: { key: ADMIN_APP_SEED.key },
    update: {
      displayName: ADMIN_APP_SEED.displayName,
      description: ADMIN_APP_SEED.description,
      trustTier: "FIRST_PARTY",
      ownerType: "JESUS_FILM",
      ownerName: ADMIN_APP_SEED.ownerName,
      status: "ACTIVE",
    },
    create: {
      key: ADMIN_APP_SEED.key,
      displayName: ADMIN_APP_SEED.displayName,
      description: ADMIN_APP_SEED.description,
      trustTier: "FIRST_PARTY",
      ownerType: "JESUS_FILM",
      ownerName: ADMIN_APP_SEED.ownerName,
      status: "ACTIVE",
    },
  })

  for (const environment of ADMIN_APP_SEED.environments) {
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
        name: `${ADMIN_APP_SEED.displayName} (${environment.key})`,
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
          appKey: ADMIN_APP_SEED.key,
          environmentKey: environment.key,
          environmentKind: environment.kind,
          trustTier: ADMIN_APP_SEED.trustTier,
        },
      },
      create: {
        clientId: environment.clientId,
        name: `${ADMIN_APP_SEED.displayName} (${environment.key})`,
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
          appKey: ADMIN_APP_SEED.key,
          environmentKey: environment.key,
          environmentKind: environment.kind,
          trustTier: ADMIN_APP_SEED.trustTier,
        },
      },
    })
  }

  return {
    apps: 1,
    environments: ADMIN_APP_SEED.environments.length,
    oauthClients: ADMIN_APP_SEED.environments.length,
    scopes: AUTH_SCOPES.length,
  }
}

function toEnvironmentKind(kind: string) {
  return kind.toUpperCase() as "LOCAL" | "PREVIEW" | "STAGING" | "PRODUCTION"
}

if (process.argv[1]?.endsWith("seed-first-party-apps.ts")) {
  seedFirstPartyApps()
    .then((result) => {
      console.log(
        `Seeded ${result.apps} first-party app, ${result.environments} environments, ${result.oauthClients} OAuth clients, and ${result.scopes} scopes.`,
      )
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
