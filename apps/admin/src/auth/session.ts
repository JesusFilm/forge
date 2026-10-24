import { headers as nextHeaders } from "next/headers"
import { redirect } from "next/navigation"
import {
  ADMIN_OAUTH_SESSION_COOKIE,
  readAdminOAuthSessionDetails,
  readAdminOAuthSessionCookie,
} from "@/auth/auth-session"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"

async function resolveFromHeaders(headers: Headers): Promise<Principal | null> {
  return await readAdminOAuthSessionCookie(
    readCookie(headers.get("cookie"), ADMIN_OAUTH_SESSION_COOKIE),
  )
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

export async function resolveAdminSessionFromRequest(request: Request) {
  return readAdminOAuthSessionDetails(
    readCookie(request.headers.get("cookie"), ADMIN_OAUTH_SESSION_COOKIE),
  )
}

export async function requireSession(): Promise<Principal> {
  const principal = await resolveFromHeaders(await nextHeaders())
  if (!principal) {
    redirect("/api/auth/login?returnTo=/dashboard")
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
