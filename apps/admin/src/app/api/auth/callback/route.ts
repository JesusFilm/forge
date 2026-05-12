import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  ADMIN_OAUTH_CALLBACK_COOKIE,
  ADMIN_OAUTH_SESSION_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_OAUTH_VERIFIER_COOKIE,
  adminOAuthCookieOptions,
  createAdminOAuthSessionCookie,
} from "@/auth/auth-session"
import {
  exchangeAdminAuthorizationCode,
  getAdminOAuthConfig,
  verifyAdminIdToken,
} from "@/auth/oauth-client"
import { prisma } from "@/db/client"

export async function GET(request: Request) {
  const config = getAdminOAuthConfig()
  if (!config) {
    return NextResponse.redirect(new URL("/login?error=forbidden", request.url))
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(ADMIN_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(ADMIN_OAUTH_VERIFIER_COOKIE)?.value
  const callbackUrl =
    cookieStore.get(ADMIN_OAUTH_CALLBACK_COOKIE)?.value ?? "/dashboard"

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    return NextResponse.redirect(new URL("/login?error=forbidden", request.url))
  }

  try {
    const tokenResponse = await exchangeAdminAuthorizationCode({
      config,
      code,
      codeVerifier,
    })
    const verifiedToken = await verifyAdminIdToken({
      config,
      idToken: tokenResponse.id_token,
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
    })
    const user = await resolveAdminUser({
      subject: verifiedToken.subject,
      email: verifiedToken.email,
      name: verifiedToken.name,
      role: roleFromScopes(verifiedToken.scopes),
    })

    const response = NextResponse.redirect(new URL(callbackUrl, request.url))
    response.cookies.set(
      ADMIN_OAUTH_SESSION_COOKIE,
      await createAdminOAuthSessionCookie(user, verifiedToken.scopes),
      adminOAuthCookieOptions(),
    )
    response.cookies.delete(ADMIN_OAUTH_STATE_COOKIE)
    response.cookies.delete(ADMIN_OAUTH_VERIFIER_COOKIE)
    response.cookies.delete(ADMIN_OAUTH_CALLBACK_COOKIE)

    return response
  } catch {
    return NextResponse.redirect(new URL("/login?error=forbidden", request.url))
  }
}

type AdminUserRole = "ADMIN" | "EDITOR" | "VIEWER"

async function resolveAdminUser({
  subject,
  email,
  name,
  role,
}: {
  subject: string
  email?: string
  name?: string
  role: AdminUserRole
}) {
  const resolvedEmail = email ?? `${subject}@auth.local`
  const resolvedName = name ?? email ?? "Auth user"

  if (email) {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    })

    if (existingUser) {
      return prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: resolvedName,
          emailVerified: true,
          role: highestRole(existingUser.role, role),
        },
        select: { id: true, role: true },
      })
    }
  }

  return prisma.user.upsert({
    where: { id: subject },
    update: {
      email: resolvedEmail,
      name: resolvedName,
      role,
    },
    create: {
      id: subject,
      email: resolvedEmail,
      name: resolvedName,
      emailVerified: true,
      role,
    },
    select: { id: true, role: true },
  })
}

function roleFromScopes(scopes: string[]): AdminUserRole {
  if (scopes.includes("admin:content:write")) return "EDITOR"
  return "VIEWER"
}

function highestRole(current: AdminUserRole, incoming: AdminUserRole) {
  const rank: Record<AdminUserRole, number> = {
    VIEWER: 1,
    EDITOR: 2,
    ADMIN: 3,
  }

  return rank[current] >= rank[incoming] ? current : incoming
}
