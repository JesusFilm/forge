import { headers as nextHeaders } from "next/headers"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { auth } from "@/auth/config"
import { prisma } from "@/db/client"

export type SessionPrincipal = Principal & {
  email: string
  expiresAt?: Date | null
}

async function resolveFromHeaders(headers: Headers): Promise<Principal | null> {
  const session = await resolveSessionFromHeaders(headers)
  if (!session) {
    return null
  }
  return {
    id: session.id,
    role: session.role,
    managerRole: session.managerRole,
  }
}

async function resolveSessionFromHeaders(
  headers: Headers,
): Promise<SessionPrincipal | null> {
  const session = await auth.api.getSession({ headers })
  if (!session?.user?.id) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      managerMembership: {
        select: { role: true, revokedAt: true },
      },
    },
  })

  if (!user) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    managerRole:
      user.managerMembership?.revokedAt == null
        ? (user.managerMembership?.role ?? null)
        : null,
    expiresAt:
      "session" in session &&
      session.session != null &&
      typeof session.session === "object" &&
      "expiresAt" in session.session &&
      session.session.expiresAt instanceof Date
        ? session.session.expiresAt
        : null,
  }
}

export async function resolvePrincipalFromRequest(
  request: Request,
): Promise<Principal | null> {
  return resolveFromHeaders(request.headers)
}

export async function resolveManagerSessionFromRequest(
  request: Request,
): Promise<SessionPrincipal | null> {
  return resolveSessionFromHeaders(request.headers)
}

export async function requireSession(): Promise<Principal> {
  const principal = await resolveFromHeaders(await nextHeaders())
  if (!principal) {
    redirect("/login")
  }
  return principal
}

export async function requireAdminSession(): Promise<Principal> {
  const principal = await requireSession()
  if (!hasPermission(principal, "admin:all")) {
    redirect("/dashboard")
  }
  return principal
}
