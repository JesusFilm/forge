import { headers as nextHeaders } from "next/headers"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { auth } from "@/auth/config"
import { prisma } from "@/db/client"

async function resolveFromHeaders(headers: Headers): Promise<Principal | null> {
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
