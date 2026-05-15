import { prisma } from "@/db/client"

const DYNAMIC_PREVIEW_CLIENT_IDS = new Set([
  "jfp_admin_preview",
  "jfp_admin_staging",
])

const ADMIN_RAILWAY_PREVIEW_HOSTNAME =
  /^(?:forge-admin|forgeadmin)(?:-[a-z0-9]+)*\.up\.railway\.app$/

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
      ADMIN_RAILWAY_PREVIEW_HOSTNAME.test(url.hostname) &&
      url.pathname === "/api/auth/callback" &&
      url.search === "" &&
      url.hash === ""
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
    !isDynamicRailwayPreviewRedirectUriAllowed({ clientId, redirectUri })
  ) {
    return
  }

  const origin = new URL(redirectUri).origin
  const postLogoutRedirectUri = `${origin}/api/auth/login`

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

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value]
}
