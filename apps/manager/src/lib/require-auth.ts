// Server component authentication guard.
// Validates the Strapi JWT from cookies and ensures the user has the Manager role.
// Redirects to /login if authentication fails.

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { fetchUserWithRole } from "@/lib/auth"

export async function requireAuth(): Promise<void> {
  const cookieStore = await cookies()
  const jwt = cookieStore.get("strapi-jwt")?.value

  if (!jwt) {
    redirect("/login")
  }

  // Decode JWT payload to get user ID (Strapi JWTs are signed, not encrypted)
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64url").toString(),
    ) as { id?: number }

    if (!payload.id) {
      redirect("/login")
    }

    const user = await fetchUserWithRole(payload.id)
    if (!user || user.role?.name !== "Manager") {
      redirect("/login")
    }
  } catch {
    redirect("/login")
  }
}
