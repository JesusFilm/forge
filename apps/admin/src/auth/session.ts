import { headers as nextHeaders } from "next/headers"
import { redirect } from "next/navigation"
import type { Principal } from "@/auth/principal"
import { auth } from "@/auth/config"
import { prisma } from "@/db/client"

async function lookupPrincipal(headers: Headers): Promise<Principal | null> {
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

export async function resolvePrincipalFromHeaders(
  headers: Headers,
): Promise<Principal | null> {
  return lookupPrincipal(headers)
}

export async function resolvePrincipalFromRequest(
  request: Request,
): Promise<Principal | null> {
  return lookupPrincipal(request.headers)
}

export async function requireSession(): Promise<Principal> {
  const principal = await lookupPrincipal(await nextHeaders())
  if (!principal) {
    redirect("/login")
  }
  return principal
}
