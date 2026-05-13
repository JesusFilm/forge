import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  ADMIN_OAUTH_ACCESS_REQUEST_COOKIE,
  ADMIN_OAUTH_CALLBACK_COOKIE,
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
    console.warn("admin.oauth.callback.forbidden", {
      reason: "invalid_state",
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasExpectedState: Boolean(expectedState),
      stateMatches: state === expectedState,
      hasCodeVerifier: Boolean(codeVerifier),
    })

    return redirectToForbiddenLogin(config)
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
    })

    if (!user || user.role === "VIEWER") {
      return await redirectToForbiddenLogin(config, {
        subject: verifiedToken.subject,
        email: verifiedToken.email,
        name: verifiedToken.name,
      })
    }

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
  } catch (error) {
    console.warn("admin.oauth.callback.forbidden", {
      reason: "callback_failed",
      message: error instanceof Error ? error.message : "unknown",
    })

    return await redirectToForbiddenLogin(config)
  }
}

async function redirectToForbiddenLogin(
  config: NonNullable<ReturnType<typeof getAdminOAuthConfig>>,
  accessRequest?: { subject: string; email?: string; name?: string },
) {
  const url = new URL("/login", config.adminBaseUrl)
  url.searchParams.set("error", "forbidden")
  if (accessRequest) {
    url.searchParams.set("request", "available")
  }
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

async function resolveAdminUser({
  subject,
  email,
  name,
}: {
  subject: string
  email?: string
  name?: string
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
        },
        select: { id: true, role: true },
      })
    }
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: subject },
    select: { id: true, role: true },
  })

  if (existingUser) {
    return prisma.user.update({
      where: { id: existingUser.id },
      data: {
        email: resolvedEmail,
        name: resolvedName,
        emailVerified: Boolean(email),
      },
      select: { id: true, role: true },
    })
  }

  return null
}
