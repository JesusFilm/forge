import { createHash, randomUUID } from "node:crypto"

import { auth, authRouteHandlers } from "@/auth/config"
import { verifyFirebaseIdToken } from "@/auth/firebase-admin"
import { signInWithFirebasePassword } from "@/auth/firebase-rest"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { getAuthBaseUrl } from "@/config/env"
import { prisma } from "@/db/client"
import { ensureDynamicPreviewRedirectUriRegistered } from "@/services/dynamic-preview-redirect.service"

type RouteContext = {
  params: Promise<{ all?: string[] }>
}

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10
const LAST_LOGIN_METHOD_COOKIE = "forge_auth_last_login_method"
const LAST_LOGIN_METHOD_MAX_AGE = 60 * 60 * 24 * 365

type LastLoginMethod = "apple" | "email" | "facebook" | "google" | "okta"

function isFormPostRequest(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.includes("application/x-www-form-urlencoded") ?? false
  )
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function audit(event: string, email?: string): void {
  console.log(
    JSON.stringify({
      event,
      emailHash: email ? sha256(email.trim().toLowerCase()) : undefined,
      service: "forge-auth",
    }),
  )
}

function isLastLoginMethod(
  value: string | undefined,
): value is LastLoginMethod {
  return (
    value === "apple" ||
    value === "email" ||
    value === "facebook" ||
    value === "google" ||
    value === "okta"
  )
}

function lastLoginMethodCookie(method: LastLoginMethod): string {
  const parts = [
    `${LAST_LOGIN_METHOD_COOKIE}=${encodeURIComponent(method)}`,
    "Path=/",
    `Max-Age=${LAST_LOGIN_METHOD_MAX_AGE}`,
    "SameSite=Lax",
  ]

  if (getAuthBaseUrl().startsWith("https://")) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

function withLastLoginMethodCookie(
  response: Response,
  method: LastLoginMethod,
): Response {
  const headers = new Headers(response.headers)
  headers.append("set-cookie", lastLoginMethodCookie(method))

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function hasAuthSessionCookie(response: Response): boolean {
  return (response.headers.get("set-cookie") ?? "").includes(
    "better-auth.session",
  )
}

function isRedirectSuccess(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false
  if (!hasAuthSessionCookie(response)) return false

  const location = response.headers.get("location")
  if (!location) return true

  try {
    return !new URL(location, getAuthBaseUrl()).searchParams.has("error")
  } catch {
    return true
  }
}

async function parseEmailPasswordRequest(request: Request): Promise<{
  email: string
  isFormPost: boolean
  oauthQuery?: string
  password: string
}> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      email?: string
      oauth_query?: string
      password?: string
    }
    return {
      email: body.email?.trim().toLowerCase() ?? "",
      isFormPost: false,
      oauthQuery: body.oauth_query,
      password: body.password ?? "",
    }
  }

  const body = await request.formData()
  return {
    email: String(body.get("email") ?? "")
      .trim()
      .toLowerCase(),
    isFormPost: true,
    oauthQuery:
      typeof body.get("oauth_query") === "string"
        ? String(body.get("oauth_query"))
        : undefined,
    password: String(body.get("password") ?? ""),
  }
}

function genericUnauthorized(): Response {
  return Response.json({ error: "Invalid email or password" }, { status: 401 })
}

function oauthQueryFromLoginReferer(request: Request): string | undefined {
  const referer = request.headers.get("referer")
  if (!referer) return undefined

  try {
    const url = new URL(referer)
    if (url.pathname !== "/login") return undefined

    url.searchParams.delete("error")
    return url.searchParams.toString() || undefined
  } catch {
    return undefined
  }
}

function rejectEmailSignIn({
  isFormPost,
  oauthQuery,
}: {
  isFormPost: boolean
  oauthQuery?: string
}): Response {
  if (!isFormPost) return genericUnauthorized()

  const url = new URL("/login", getAuthBaseUrl())
  if (oauthQuery) url.search = oauthQuery
  url.searchParams.set("error", "credentials")
  return Response.redirect(url, 303)
}

function toJsonRequest(original: Request, body: object): Request {
  return new Request(original.url, {
    method: original.method,
    headers: new Headers({
      ...Object.fromEntries(original.headers.entries()),
      "content-type": "application/json",
    }),
    body: JSON.stringify(body),
  })
}

function buildOAuthContinuationURL(oauthQuery: string | undefined) {
  if (!oauthQuery) return undefined

  const url = new URL("/api/auth/oauth2/authorize", getAuthBaseUrl())
  url.search = oauthQuery
  return url.toString()
}

async function parseSocialSignInRequest(request: Request): Promise<{
  body: Record<string, unknown>
  oauthQuery?: string
}> {
  const body = (await request.json()) as {
    oauth_query?: unknown
    [key: string]: unknown
  }

  return {
    body,
    oauthQuery:
      typeof body.oauth_query === "string" ? body.oauth_query : undefined,
  }
}

async function handleSocialSignIn(request: Request): Promise<Response> {
  const { body, oauthQuery } = await parseSocialSignInRequest(request)
  const callbackURL = buildOAuthContinuationURL(oauthQuery)
  const betterAuthBody = { ...body }
  delete betterAuthBody.oauth_query

  return authRouteHandlers.POST(
    toJsonRequest(request, {
      ...betterAuthBody,
      ...(callbackURL ? { callbackURL } : {}),
    }),
  )
}

function redirectFormPostAfterSignIn(
  response: Response,
  callbackURL: string | undefined,
): Response {
  if (!response.ok || !callbackURL) return response

  const headers = new Headers(response.headers)
  headers.set("location", callbackURL)
  headers.delete("content-length")

  return new Response(null, {
    headers,
    status: 303,
  })
}

async function handleEmailSignIn(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "sign-in/email",
    limit: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  })
  if (!limit.allowed) {
    audit("auth.firebase.rejected.rate_limited")
    return rejectEmailSignIn({
      isFormPost: isFormPostRequest(request),
      oauthQuery: oauthQueryFromLoginReferer(request),
    })
  }

  const { email, isFormPost, oauthQuery, password } =
    await parseEmailPasswordRequest(request)

  if (!email || !password) {
    audit("auth.signin.rejected", email)
    return rejectEmailSignIn({ isFormPost, oauthQuery })
  }
  const callbackURL = buildOAuthContinuationURL(oauthQuery)

  const jsonBody = {
    ...(callbackURL ? { callbackURL } : {}),
    email,
    password,
  }
  const primaryResponse = await authRouteHandlers.POST(
    toJsonRequest(request, jsonBody),
  )
  if (primaryResponse.ok || primaryResponse.status !== 401) {
    if (!primaryResponse.ok) return primaryResponse

    audit("auth.signin.success")
    return isFormPost
      ? withLastLoginMethodCookie(
          redirectFormPostAfterSignIn(primaryResponse, callbackURL),
          "email",
        )
      : withLastLoginMethodCookie(primaryResponse, "email")
  }

  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  })
  if (existingUser) {
    audit("auth.signin.rejected", email)
    return isFormPost
      ? rejectEmailSignIn({ isFormPost, oauthQuery })
      : primaryResponse
  }

  const firebaseSignIn = await signInWithFirebasePassword(email, password)
  if (!firebaseSignIn) {
    audit("auth.signin.rejected", email)
    return rejectEmailSignIn({ isFormPost, oauthQuery })
  }

  const verified = await verifyFirebaseIdToken(firebaseSignIn.idToken)
  if (!verified || verified.email.toLowerCase() !== email) {
    audit("auth.firebase.rejected.unverified", email)
    return rejectEmailSignIn({ isFormPost, oauthQuery })
  }

  const signUpResponse = await auth.api.signUpEmail({
    headers: request.headers,
    asResponse: true,
    body: {
      ...(callbackURL ? { callbackURL } : {}),
      email,
      password,
      name: email.split("@")[0] || "user",
    },
  })

  if (!signUpResponse.ok) {
    audit("auth.signin.rejected", email)
    return rejectEmailSignIn({ isFormPost, oauthQuery })
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { email },
      select: { id: true },
    })
    if (!user) {
      return
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        membershipStatus: "ACTIVE",
      },
    })

    await tx.account.upsert({
      where: {
        providerId_accountId: {
          providerId: "firebase",
          accountId: verified.uid,
        },
      },
      create: {
        id: randomUUID(),
        userId: user.id,
        providerId: "firebase",
        accountId: verified.uid,
      },
      update: {
        userId: user.id,
      },
    })
  })

  audit("auth.firebase.migrated", email)
  return isFormPost
    ? withLastLoginMethodCookie(
        redirectFormPostAfterSignIn(signUpResponse, callbackURL),
        "email",
      )
    : withLastLoginMethodCookie(signUpResponse, "email")
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { all = [] } = await context.params
  if (all.join("/") === "oauth2/authorize") {
    const url = new URL(request.url)
    await ensureDynamicPreviewRedirectUriRegistered({
      clientId: url.searchParams.get("client_id"),
      redirectUri: url.searchParams.get("redirect_uri"),
    })
  }

  const response = await authRouteHandlers.GET(request)
  const providerId = all[1]
  if (
    all[0] === "callback" &&
    isLastLoginMethod(providerId) &&
    isRedirectSuccess(response)
  ) {
    return withLastLoginMethodCookie(response, providerId)
  }

  return response
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { all = [] } = await context.params
  const path = all.join("/")

  if (path === "sign-in/email") {
    return handleEmailSignIn(request)
  }
  if (path === "sign-in/social") {
    return handleSocialSignIn(request)
  }
  if (path === "sign-up/email") {
    audit("auth.signup.rejected.public")
    return Response.json({ error: "Not found" }, { status: 404 })
  }
  return authRouteHandlers.POST(request)
}

export async function OPTIONS(request: Request): Promise<Response> {
  const headers = new Headers()
  headers.set(
    "access-control-allow-methods",
    "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  )
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ??
      "content-type, authorization",
  )
  headers.set("access-control-max-age", "86400")
  return new Response(null, { status: 204, headers })
}

export async function PATCH(request: Request): Promise<Response> {
  return authRouteHandlers.PATCH(request)
}

export async function PUT(request: Request): Promise<Response> {
  return authRouteHandlers.PUT(request)
}

export async function DELETE(request: Request): Promise<Response> {
  return authRouteHandlers.DELETE(request)
}
