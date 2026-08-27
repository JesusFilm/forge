import { createHash } from "node:crypto"

import {
  ADMIN_MCP_CODEX_CLIENT_ID,
  ADMIN_MCP_DEFAULT_SCOPES,
  FIRST_PARTY_APP_SEEDS,
  FIRST_PARTY_OAUTH_CLIENT_IDS,
  isFirstPartyOAuthClientId,
  TV_DEVICE_CLIENT_IDS,
  type RegisteredAppSeed,
} from "@/domain/apps"
import {
  createOAuthResourceCatalog,
  getPublicDcrResources,
  resolveOAuthResource,
} from "@/domain/oauth-resources"
import { AUTH_SCOPES, type AuthScopeKey } from "@/domain/scopes"
import { getAuthBaseUrl, getAuthCustomAudiences } from "@/config/env"
import { prisma } from "@/db/client"
// Imported, never re-declared. This seeder is the ONLY writer of the device
// grant type and `resolveDeviceClient` is its only reader, so a second copy of
// the literal would be a producer/consumer seam where one edit silently kills
// every TV sign-in (the gate fails closed and no test observes both halves).
import { DEVICE_GRANT_TYPE } from "@/services/device-client.service"
import { finalizeBetterAuth17Schema } from "./finalize-better-auth-17-schema"

const MANAGER_SESSION_SCOPE = "admin:manager-session:validate"
const BROWSER_GRANT_TYPES = ["authorization_code", "refresh_token"]
const TV_DEVICE_CLIENT_ID_SET = new Set<string>(TV_DEVICE_CLIENT_IDS)
const OFFLINE_ACCESS_SCOPE = "offline_access" satisfies AuthScopeKey
// Markers identify PRE-EXISTING dynamically-registered Admin MCP clients so
// later-added default scopes can be appended. They must exclude every scope
// added AFTER those clients were registered — offline_access itself and the
// feat-320 experience-level pair — because a legacy client cannot carry them
// (the pair reaches clients via re-authentication, not this migration).
const POST_REGISTRATION_SCOPES: readonly AuthScopeKey[] = [
  OFFLINE_ACCESS_SCOPE,
  "experience:create",
  "experience:generate",
]
const ADMIN_MCP_DYNAMIC_SCOPE_MARKERS = ADMIN_MCP_DEFAULT_SCOPES.filter(
  (scope) => !POST_REGISTRATION_SCOPES.includes(scope),
)

export async function seedFirstPartyApps() {
  await finalizeBetterAuth17Schema()

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

  const publicResourcePolicies = getPublicResourcePolicies()
  await seedFirstPartyOauthResources(publicResourcePolicies)
  await assertPublicDcrResourcesSeeded(publicResourcePolicies)
  const resourceRepair = await repairExistingPublicLoopbackMcpClients(
    publicResourcePolicies.map(({ identifier }) => identifier),
  )
  const offlineAccessUpdatedClients =
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
    resourceRepair: {
      ...resourceRepair,
      offlineAccessUpdatedClients,
    },
  }
}

function getPublicResourcePolicies() {
  const catalogue = createOAuthResourceCatalog({
    authIssuer: getAuthBaseUrl(),
    customAudiences: getAuthCustomAudiences(),
  })
  const publicResourceIds = new Set(getPublicDcrResources(catalogue))
  return catalogue.filter(({ identifier }) => publicResourceIds.has(identifier))
}

async function seedFirstPartyOauthResources(
  publicResourcePolicies: ReturnType<typeof getPublicResourcePolicies>,
) {
  for (const appSeed of FIRST_PARTY_APP_SEEDS) {
    for (const environment of appSeed.environments) {
      const resources: Array<{
        identifier: string
        name: string
        allowedScopes: string[]
        clientId: string
      }> = []

      if (
        environment.managerSessionServiceClientId &&
        environment.managerSessionServiceAudience
      ) {
        resources.push({
          identifier: environment.managerSessionServiceAudience,
          name: `${appSeed.displayName} (${environment.key} session validation)`,
          allowedScopes: [MANAGER_SESSION_SCOPE],
          clientId: environment.managerSessionServiceClientId,
        })
      }

      if (environment.mcpResourceAudience) {
        const identifier = environment.mcpResourceAudience
        const policy = resolveOAuthResource(publicResourcePolicies, identifier)
        if (!policy) throw new Error("Missing public OAuth resource policy")
        resources.push({
          identifier,
          name: `${appSeed.displayName} (${environment.key})`,
          allowedScopes: [...policy.allowedScopes],
          clientId: environment.clientId,
        })
      }

      for (const resource of resources) {
        await prisma.oauthResource.upsert({
          where: { identifier: resource.identifier },
          update: {
            name: resource.name,
            allowedScopes: resource.allowedScopes,
            disabled: false,
          },
          create: {
            identifier: resource.identifier,
            name: resource.name,
            allowedScopes: resource.allowedScopes,
            disabled: false,
          },
        })
        await prisma.oauthClientResource.upsert({
          where: {
            clientId_resourceId: {
              clientId: resource.clientId,
              resourceId: resource.identifier,
            },
          },
          update: {},
          create: {
            clientId: resource.clientId,
            resourceId: resource.identifier,
          },
        })
      }
    }
  }
}

async function assertPublicDcrResourcesSeeded(
  policies: ReturnType<typeof getPublicResourcePolicies>,
) {
  const rows = await prisma.oauthResource.findMany({
    where: { identifier: { in: policies.map(({ identifier }) => identifier) } },
    select: { allowedScopes: true, disabled: true, identifier: true },
  })
  const rowsByIdentifier = new Map(rows.map((row) => [row.identifier, row]))
  const matchingRows = policies.filter((policy) => {
    const row = rowsByIdentifier.get(policy.identifier)
    return (
      row != null &&
      !row.disabled &&
      sameStringSet(row.allowedScopes, policy.allowedScopes)
    )
  }).length

  if (matchingRows !== policies.length || rows.length !== policies.length) {
    throw new Error(
      `Public OAuth resource seed invariant failed (${matchingRows}/${policies.length} scope-compatible rows)`,
    )
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  )
}

async function repairExistingPublicLoopbackMcpClients(
  publicResourceIds: string[],
) {
  const clients = await prisma.oauthClient.findMany({
    where: {
      applicationType: "native",
      clientId: { notIn: FIRST_PARTY_OAUTH_CLIENT_IDS },
      clientSecret: null,
      disabled: false,
      grantTypes: { hasEvery: [...BROWSER_GRANT_TYPES] },
      OR: [{ public: true }, { public: null }],
      tokenEndpointAuthMethod: "none",
    },
    select: {
      applicationType: true,
      clientId: true,
      clientSecret: true,
      disabled: true,
      grantTypes: true,
      public: true,
      redirectUris: true,
      requirePKCE: true,
      resourceLinks: {
        where: { resourceId: { in: publicResourceIds } },
        select: { resourceId: true },
      },
      tokenEndpointAuthMethod: true,
    },
  })

  let eligibleClients = 0
  let repairedClients = 0
  let createdLinks = 0
  for (const client of clients) {
    if (!isEligiblePublicLoopbackClient(client)) continue
    eligibleClients += 1
    const linkedResourceIds = new Set(
      client.resourceLinks.map(({ resourceId }) => resourceId),
    )
    const missingResourceIds = publicResourceIds.filter(
      (resourceId) => !linkedResourceIds.has(resourceId),
    )
    if (missingResourceIds.length === 0) continue

    await prisma.$transaction(async (tx) => {
      for (const resourceId of missingResourceIds) {
        await tx.oauthClientResource.upsert({
          where: {
            clientId_resourceId: { clientId: client.clientId, resourceId },
          },
          update: {},
          create: { clientId: client.clientId, resourceId },
        })
      }
    })
    repairedClients += 1
    createdLinks += missingResourceIds.length
  }

  return { eligibleClients, repairedClients, createdLinks }
}

function isEligiblePublicLoopbackClient(client: {
  applicationType: string | null
  clientId: string
  clientSecret: string | null
  disabled: boolean
  grantTypes: string[]
  public: boolean | null
  redirectUris: string[]
  requirePKCE: boolean | null
  tokenEndpointAuthMethod: string | null
}) {
  return (
    !isFirstPartyOAuthClientId(client.clientId) &&
    client.applicationType === "native" &&
    client.public !== false &&
    client.clientSecret == null &&
    !client.disabled &&
    client.tokenEndpointAuthMethod === "none" &&
    client.requirePKCE !== false &&
    BROWSER_GRANT_TYPES.every((grantType) =>
      client.grantTypes.includes(grantType),
    ) &&
    client.redirectUris.length > 0 &&
    client.redirectUris.every(isCodexLoopbackMcpCallback)
  )
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

  let updatedClients = 0
  for (const client of candidates) {
    if (!isExistingDynamicAdminMcpClientMissingOfflineAccess(client)) continue

    await prisma.oauthClient.update({
      where: { clientId: client.clientId },
      data: {
        scopes: [...client.scopes, OFFLINE_ACCESS_SCOPE],
      },
    })
    updatedClients += 1
  }
  return updatedClients
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

// The device grant is admitted per registered client, not globally: the device
// endpoints check OauthClient.grantTypes, and dynamic client registration is
// open, so only the seeded TV client ids may ever carry the device grant type.
// Every other first-party client keeps exactly the browser grant pair.
function getGrantTypes(clientId: string) {
  return TV_DEVICE_CLIENT_ID_SET.has(clientId)
    ? [...BROWSER_GRANT_TYPES, DEVICE_GRANT_TYPE]
    : [...BROWSER_GRANT_TYPES]
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
        applicationType:
          environment.clientId === ADMIN_MCP_CODEX_CLIENT_ID ? "native" : "web",
        clientCredentialsScopes: [],
        grantTypes: getGrantTypes(environment.clientId),
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
        applicationType:
          environment.clientId === ADMIN_MCP_CODEX_CLIENT_ID ? "native" : "web",
        clientCredentialsScopes: [],
        grantTypes: getGrantTypes(environment.clientId),
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
          applicationType: "web",
          clientCredentialsScopes: [MANAGER_SESSION_SCOPE],
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
          applicationType: "web",
          clientCredentialsScopes: [MANAGER_SESSION_SCOPE],
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
        `Seeded ${result.apps} first-party apps, ${result.environments} environments, ${result.oauthClients} OAuth clients, and ${result.scopes} scopes. Public MCP repair: ${result.resourceRepair.eligibleClients} eligible clients, ${result.resourceRepair.repairedClients} repaired clients, ${result.resourceRepair.createdLinks} links added, ${result.resourceRepair.offlineAccessUpdatedClients} legacy clients updated for offline access.`,
      )
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
