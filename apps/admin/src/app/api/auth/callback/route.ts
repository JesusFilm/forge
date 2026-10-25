import type { UserRole } from "@prisma/client"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  ADMIN_OAUTH_ACCESS_REQUEST_COOKIE,
  ADMIN_OAUTH_RETURN_TO_COOKIE,
  ADMIN_OAUTH_SESSION_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_OAUTH_VERIFIER_COOKIE,
  adminOAuthAccessRequestCookieOptions,
  adminOAuthCookieOptions,
  createAdminOAuthAccessRequestCookie,
  createAdminOAuthSessionCookie,
} from "@/auth/auth-session"
import {
  exchangeAdminAuthorizationCode,
  getAdminOAuthConfig,
  verifyAdminIdToken,
} from "@/auth/oauth-client"
import {
  type AdminSubjectBindingConflict,
  recordAdminSubjectBinding,
} from "@/auth/admin-subject-binding"
import { prisma } from "@/db/client"

export async function GET(request: Request) {
  const config = getAdminOAuthConfig()
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(ADMIN_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(ADMIN_OAUTH_VERIFIER_COOKIE)?.value
  const returnTo =
    cookieStore.get(ADMIN_OAUTH_RETURN_TO_COOKIE)?.value ?? "/dashboard"

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    console.warn("admin.oauth.callback.forbidden", {
      reason: "invalid_state",
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasExpectedState: Boolean(expectedState),
      stateMatches: state === expectedState,
      hasCodeVerifier: Boolean(codeVerifier),
    })

    return redirectToAccessRequest(config)
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
    const resolution = await resolveAdminUser({
      subject: verifiedToken.subject,
      email: verifiedToken.email,
      name: verifiedToken.name,
    })

    if (resolution.kind === "binding_conflict") {
      // Never log the subject or email; the closed reason is enough to route
      // an operator to the binding table.
      console.warn("admin.oauth.callback.forbidden", {
        reason: "subject_binding_conflict",
        conflict: resolution.reason,
      })
      return await redirectToAccessRequest(config)
    }
    const user = resolution.kind === "user" ? resolution.user : null

    if (!user || user.role === "VIEWER") {
      return await redirectToAccessRequest(config, {
        subject: verifiedToken.subject,
        email: verifiedToken.email,
        name: verifiedToken.name,
      })
    }

    const response = NextResponse.redirect(new URL(returnTo, request.url))
    response.cookies.set(
      ADMIN_OAUTH_SESSION_COOKIE,
      await createAdminOAuthSessionCookie(user, verifiedToken.scopes),
      adminOAuthCookieOptions(),
    )
    response.cookies.delete(ADMIN_OAUTH_STATE_COOKIE)
    response.cookies.delete(ADMIN_OAUTH_VERIFIER_COOKIE)
    response.cookies.delete(ADMIN_OAUTH_RETURN_TO_COOKIE)

    return response
  } catch (error) {
    console.warn("admin.oauth.callback.forbidden", {
      reason: "callback_failed",
      message: error instanceof Error ? error.message : "unknown",
    })

    return await redirectToAccessRequest(config)
  }
}

async function redirectToAccessRequest(
  config: ReturnType<typeof getAdminOAuthConfig>,
  accessRequest?: { subject: string; email?: string; name?: string },
) {
  const url = new URL("/access-request", config.adminBaseUrl)
  if (!accessRequest) url.searchParams.set("error", "forbidden")
  const response = NextResponse.redirect(url)
  if (accessRequest) {
    response.cookies.set(
      ADMIN_OAUTH_ACCESS_REQUEST_COOKIE,
      await createAdminOAuthAccessRequestCookie(accessRequest),
      adminOAuthAccessRequestCookieOptions(),
    )
  }
  return response
}

type AdminUserResolution =
  | { kind: "user"; user: { id: string; role: UserRole } }
  | { kind: "none" }
  | { kind: "binding_conflict"; reason: AdminSubjectBindingConflict }

/**
 * Resolves the existing Admin user for a verified Auth identity (email first,
 * then the subject as id), records the durable subject → user binding, and
 * only then refreshes the profile columns. A binding conflict rejects the
 * sign-in before any user row is written.
 */
async function resolveAdminUser({
  subject,
  email,
  name,
}: {
  subject: string
  email?: string
  name?: string
}): Promise<AdminUserResolution> {
  const resolvedEmail = email ?? `${subject}@auth.local`
  const resolvedName = name ?? email ?? "Auth user"

  const byEmail = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, role: true },
      })
    : null
  const candidate =
    byEmail ??
    (await prisma.user.findUnique({
      where: { id: subject },
      select: { id: true, role: true },
    }))
  if (!candidate) return { kind: "none" }

  const binding = await recordAdminSubjectBinding(prisma, {
    subject,
    userId: candidate.id,
  })
  if (!binding.ok) return { kind: "binding_conflict", reason: binding.reason }

  const user = await prisma.user.update({
    where: { id: candidate.id },
    data: byEmail
      ? { name: resolvedName, emailVerified: true }
      : {
          email: resolvedEmail,
          name: resolvedName,
          emailVerified: Boolean(email),
        },
    select: { id: true, role: true },
  })
  return { kind: "user", user }
}
