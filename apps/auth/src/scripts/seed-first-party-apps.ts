import { FIRST_PARTY_APP_SEEDS, type RegisteredAppSeed } from "@/domain/apps"
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

  for (const appSeed of FIRST_PARTY_APP_SEEDS) {
    await seedFirstPartyApp(appSeed)
  }

  return {
    apps: FIRST_PARTY_APP_SEEDS.length,
    environments: FIRST_PARTY_APP_SEEDS.reduce(
      (total, app) => total + app.environments.length,
      0,
    ),
    oauthClients: FIRST_PARTY_APP_SEEDS.reduce(
      (total, app) => total + app.environments.length,
      0,
    ),
    scopes: AUTH_SCOPES.length,
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
  }
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
