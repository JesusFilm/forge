import { prisma } from "@/db/client"

const DYNAMIC_PREVIEW_CLIENT_IDS = new Set([
  "jfp_admin_preview",
  "jfp_admin_staging",
  "jfp_mastra_studio_preview",
  "jfp_mastra_studio_staging",
])
const DYNAMIC_LOCAL_WEB_CLIENT_IDS = new Set(["jfp_web_local"])

// OAuth clients ultimately need exact redirect URIs, but Railway PR previews
// receive generated hostnames. Treat these regexes as tightly scoped wildcards:
// if a preview/staging client requests a matching callback URL, persist that
// exact URI before handing the request to the OAuth provider.
const ADMIN_RAILWAY_PREVIEW_HOSTNAME =
  /^(?:forge-admin|forgeadmin)(?:-[a-z0-9]+)*\.up\.railway\.app$/
const MASTRA_STUDIO_RAILWAY_PREVIEW_HOSTNAME =
  /^(?:forge-mastra-studio|forge-mastra-gateway|forgemastra-gateway|forgemastra-studio)(?:-[a-z0-9]+)*\.up\.railway\.app$/

export function isDynamicRailwayPreviewRedirectUriAllowed({
  clientId,
  redirectUri,
}: {
  clientId: string
  redirectUri: string
}) {
  if (!DYNAMIC_PREVIEW_CLIENT_IDS.has(clientId)) {
    return false
  }

  try {
    const url = new URL(redirectUri)
    return (
      url.protocol === "https:" &&
      isAllowedPreviewHostname(clientId, url.hostname) &&
      url.pathname === "/api/auth/callback" &&
      url.search === "" &&
      url.hash === ""
    )
  } catch {
    return false
  }
}

export function isDynamicLocalWebRedirectUriAllowed({
  clientId,
  redirectUri,
}: {
  clientId: string
  redirectUri: string
}) {
  if (!DYNAMIC_LOCAL_WEB_CLIENT_IDS.has(clientId)) {
    return false
  }

  try {
    const url = new URL(redirectUri)
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname === "/watch/api/auth/callback" &&
      url.search === "" &&
      url.hash === "" &&
      url.port.length > 0
    )
  } catch {
    return false
  }
}

export async function ensureDynamicPreviewRedirectUriRegistered({
  clientId,
  redirectUri,
}: {
  clientId: string | null
  redirectUri: string | null
}) {
  if (
    !clientId ||
    !redirectUri ||
    !isDynamicRedirectUriAllowed({ clientId, redirectUri })
  ) {
    return
  }

  const origin = new URL(redirectUri).origin
  const postLogoutRedirectUri = redirectUri.includes("/watch/api/auth/callback")
    ? `${origin}/watch`
    : `${origin}/api/auth/login`

  await prisma.$transaction(async (tx) => {
    const [client, environment] = await Promise.all([
      tx.oauthClient.findUnique({
        where: { clientId },
        select: {
          redirectUris: true,
          postLogoutRedirectUris: true,
        },
      }),
      tx.appEnvironment.findUnique({
        where: { clientId },
        select: {
          redirectUris: true,
          allowedOrigins: true,
        },
      }),
    ])

    if (client) {
      await tx.oauthClient.update({
        where: { clientId },
        data: {
          redirectUris: appendUnique(client.redirectUris, redirectUri),
          postLogoutRedirectUris: appendUnique(
            client.postLogoutRedirectUris,
            postLogoutRedirectUri,
          ),
        },
      })
    }

    if (environment) {
      await tx.appEnvironment.update({
        where: { clientId },
        data: {
          redirectUris: appendUnique(environment.redirectUris, redirectUri),
          allowedOrigins: appendUnique(environment.allowedOrigins, origin),
        },
      })
    }
  })
}

function isDynamicRedirectUriAllowed({
  clientId,
  redirectUri,
}: {
  clientId: string
  redirectUri: string
}) {
  return (
    isDynamicRailwayPreviewRedirectUriAllowed({ clientId, redirectUri }) ||
    isDynamicLocalWebRedirectUriAllowed({ clientId, redirectUri })
  )
}

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value]
}

function isAllowedPreviewHostname(clientId: string, hostname: string) {
  if (clientId.startsWith("jfp_admin_")) {
    return ADMIN_RAILWAY_PREVIEW_HOSTNAME.test(hostname)
  }

  if (clientId.startsWith("jfp_mastra_studio_")) {
    return MASTRA_STUDIO_RAILWAY_PREVIEW_HOSTNAME.test(hostname)
  }

  return false
}
