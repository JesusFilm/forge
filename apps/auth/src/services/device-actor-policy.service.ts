import type { PrismaClient } from "@/generated/prisma"

type AuthPrisma = PrismaClient

/**
 * Whether an approving user may authorize a device for this client.
 *
 * The device grant is a SECOND authorization surface. `/oauth2/authorize` runs
 * `enforceAgentOAuthAuthorizePolicy`, which refuses to let an AGENT-actor
 * session authorize a production client or any environment the agent has no
 * approved grant for. Nothing applied that policy here, so an agent session —
 * which the agent-login handle flow can mint on the deployment that also serves
 * `jfp_tv_production` — could approve a TV and walk away with a production
 * access token and a weeks-long refresh token.
 *
 * Human actors are unaffected: they return `true` on the first check, at the
 * cost of one indexed lookup.
 *
 * Kept as its own module rather than exported from the route because the route
 * imports `auth`, and the plugin is imported *by* the auth config — reusing the
 * route's copy would be an import cycle.
 */
export async function canActorApproveDevice(
  prisma: AuthPrisma,
  input: { userId: string; clientId: string },
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { actorType: true },
  })

  // Unknown user is not a human by default — fail closed rather than assume.
  if (user == null) return false
  if (user.actorType !== "AGENT") return true

  const environment = await prisma.appEnvironment.findUnique({
    where: { clientId: input.clientId },
    select: {
      kind: true,
      status: true,
      app: { select: { status: true } },
      grants: {
        where: {
          status: "APPROVED",
          subjectType: "USER",
          userId: input.userId,
        },
        select: { id: true },
        take: 1,
      },
    },
  })

  // Mirrors enforceAgentOAuthAuthorizePolicy in the auth catch-all route. Keep
  // the two in step: they guard the same thing on different surfaces.
  return (
    environment != null &&
    environment.kind !== "PRODUCTION" &&
    environment.status === "APPROVED" &&
    environment.app.status === "ACTIVE" &&
    environment.grants.length > 0
  )
}
