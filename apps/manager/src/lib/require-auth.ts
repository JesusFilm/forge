import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { MANAGER_SESSION_COOKIE } from "@/lib/manager-session-cookie"
import { verifyManagerSession } from "@/lib/auth"

type AuthUser = { id: string; username: string; email: string }

export async function requireAuth(): Promise<AuthUser> {
  const cookieStore = await cookies()
  const session = cookieStore.get(MANAGER_SESSION_COOKIE)?.value

  if (!session) {
    redirect("/login")
  }

  const user = await verifyManagerSession(session)
  if (!user || user.role?.name !== "Manager") {
    redirect("/login")
  }

  return { id: user.id, username: user.username, email: user.email }
}
