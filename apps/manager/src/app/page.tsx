import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { resolveManagerLandingPathForSession } from "@/lib/auth"
import { MANAGER_SESSION_COOKIE } from "@/lib/manager-session-cookie"

export default async function HomePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(MANAGER_SESSION_COOKIE)?.value
  const landingPath = token
    ? await resolveManagerLandingPathForSession(token)
    : null

  redirect(landingPath ?? "/login")
}
