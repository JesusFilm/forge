import { redirect } from "next/navigation"
import { requireAdminSession } from "@/auth/session"
import { prisma } from "@/db/client"

const DENIED_PATH = "/dashboard"

/**
 * Requires the signed Admin session AND a live `User.role === ADMIN` read.
 * The session cookie carries the role at sign-in time; a downgrade or
 * revocation after sign-in must deny immediately. The actor id comes only
 * from the session, never from request input.
 */
export async function requireLiveAdminSession(): Promise<{ actorId: string }> {
  const principal = await requireAdminSession()
  if (!principal.id) redirect(DENIED_PATH)
  let role: string | null = null
  try {
    const user = await prisma.user.findUnique({
      where: { id: principal.id },
      select: { role: true },
    })
    role = user?.role ?? null
  } catch {
    role = null
  }
  if (role !== "ADMIN") redirect(DENIED_PATH)
  return { actorId: principal.id }
}
