import { headers as nextHeaders } from "next/headers"
import { redirect } from "next/navigation"
import {
  ADMIN_OAUTH_SESSION_COOKIE,
  readAdminOAuthSessionCookie,
} from "@/auth/auth-session"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { auth } from "@/auth/config"
import { env } from "@/config/env"
import { prisma } from "@/db/client"

async function resolveFromHeaders(headers: Headers): Promise<Principal | null> {
  if (env.ADMIN_AUTH_MODE === "oauth") {
    return await readAdminOAuthSessionCookie(
      readCookie(headers.get("cookie"), ADMIN_OAUTH_SESSION_COOKIE),
    )
  }

  const session = await auth.api.getSession({ headers })
  if (!session?.user?.id) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  })

  if (!user) {
    return null
  }

  return { id: user.id, role: user.role }
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

export async function resolvePrincipalFromRequest(
  request: Request,
): Promise<Principal | null> {
  return resolveFromHeaders(request.headers)
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
