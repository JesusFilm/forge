// Server component authentication guard.
// Validates the Manager backend session and ensures the Manager role.
// Redirects to /login if authentication fails.

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { verifyManagerSession } from "@/lib/auth"
import {
  LEGACY_STRAPI_SESSION_COOKIE,
  MANAGER_SESSION_COOKIE,
} from "@/lib/session-cookie"

type AuthUser = { username: string; email: string }

export async function requireAuth(): Promise<AuthUser> {
  const cookieStore = await cookies()
  const sessionToken =
    cookieStore.get(MANAGER_SESSION_COOKIE)?.value ??
    cookieStore.get(LEGACY_STRAPI_SESSION_COOKIE)?.value

  if (!sessionToken) {
    redirect("/login")
  }

  const user = await verifyManagerSession(sessionToken)
  if (!user || user.role?.name !== "Manager") {
    redirect("/login")
  }

  return { username: user.username, email: user.email }
}
