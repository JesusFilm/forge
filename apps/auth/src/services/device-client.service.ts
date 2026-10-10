import type { PrismaClient } from "@/generated/prisma"

type AuthPrisma = PrismaClient

export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

export type DeviceClient = {
  clientId: string
  name: string | null
  scopes: string[]
  redirectUris: string[]
}

/**
 * Resolve a client that is allowed to use the device grant.
 *
 * The gate is `grantTypes` on the persisted `OauthClient` row, and it is
 * load-bearing rather than cosmetic: `allowDynamicClientRegistration` and
 * `allowUnauthenticatedClientRegistration` are both enabled on this provider, so
 * anyone can register a client at runtime. Only the first-party seeder writes
 * the device grant type, so a dynamically-registered client can never reach this
 * flow — which matters more here than elsewhere because the device grant has no
 * redirect-URI binding to constrain it.
 */
export async function resolveDeviceClient(
  prisma: AuthPrisma,
  clientId: string,
): Promise<DeviceClient | null> {
  const client = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: {
      clientId: true,
      name: true,
      scopes: true,
      redirectUris: true,
      grantTypes: true,
      disabled: true,
    },
  })

  if (!client) return null
  if (client.disabled) return null
  if (!client.grantTypes.includes(DEVICE_GRANT_TYPE)) return null

  return {
    clientId: client.clientId,
    name: client.name,
    scopes: client.scopes,
    redirectUris: client.redirectUris,
  }
}

/**
 * Operator kill switch. Absent means enabled: a new environment must not have a
 * silently dead sign-in surface just because a variable was never set, and the
 * TV client is independently gated by `EXPO_PUBLIC_TV_PROFILE_ENABLED`. Only an
 * explicit "false" turns it off, which a Railway variable change applies without
 * a rebuild because these are runtime handlers.
 */
export function isDeviceGrantEnabled(): boolean {
  return process.env.AUTH_DEVICE_GRANT_ENABLED !== "false"
}
