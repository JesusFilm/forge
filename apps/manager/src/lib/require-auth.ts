// Server component authentication guard.
// Validates the Strapi JWT signature via /api/users/me and ensures the Manager role.
// Redirects to /login if authentication fails.

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { verifyStrapiJwtWithRole } from "@/lib/auth"

type AuthUser = { username: string; email: string }

export async function requireAuth(): Promise<AuthUser> {
  const cookieStore = await cookies()
  const jwt = cookieStore.get("strapi-jwt")?.value

  if (!jwt) {
    redirect("/login")
  }

  const user = await verifyStrapiJwtWithRole(jwt)
  if (!user || user.role?.name !== "Manager") {
    redirect("/login")
  }

  return { username: user.username, email: user.email }
}
