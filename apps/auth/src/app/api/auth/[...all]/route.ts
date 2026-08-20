import { createHash, randomUUID } from "node:crypto"

import { auth, authRouteHandlers } from "@/auth/config"
import {
  firebaseUserExistsByEmail,
  verifyFirebaseIdToken,
} from "@/auth/firebase-admin"
import { signInWithFirebasePassword } from "@/auth/firebase-rest"
import { isLoginProviderId, type LoginProviderId } from "@/auth/login-methods"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { normalizeUserCode } from "@/lib/device-user-code"
import { resolveWebWatchCallbackURL } from "@/auth/web-callback"
import { getAuthBaseUrl } from "@/config/env"
import { prisma } from "@/db/client"
import { ensureDynamicPreviewRedirectUriRegistered } from "@/services/dynamic-preview-redirect.service"
import {
  canRedeemAgentLoginHandle,
  isAgentLoginHandle,
} from "@/services/agent-login.service"

type RouteContext = {
  params: Promise<{ all?: string[] }>
}

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10
const LAST_LOGIN_METHOD_COOKIE = "forge_auth_last_login_method"
const LAST_LOGIN_METHOD_MAX_AGE = 60 * 60 * 24 * 365

type LastLoginMethod = "apple" | "email" | "facebook" | "google" | "okta"
const providerPriority = ["google", "facebook", "apple", "okta"] as const

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
  callbackURL?: string
  email: string
  isFormPost: boolean
  oauthQuery?: string
  password: string
}> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      email?: string
      callbackURL?: string
      oauth_query?: string
      password?: string
    }
    return {
      callbackURL: resolveWebWatchCallbackURL(body.callbackURL),
      email: body.email?.trim().toLowerCase() ?? "",
      isFormPost: false,
      oauthQuery: body.oauth_query,
      password: body.password ?? "",
    }
  }

  const body = await request.formData()
  return {
    callbackURL: resolveWebWatchCallbackURL(
      typeof body.get("callbackURL") === "string"
        ? String(body.get("callbackURL"))
        : undefined,
    ),
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

async function parseLoginMethodRequest(request: Request): Promise<{
  email: string
  oauthQuery?: string
}> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      email?: string
      oauth_query?: string
    }
    return {
      email: body.email?.trim().toLowerCase() ?? "",
      oauthQuery: body.oauth_query,
    }
  }

  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return { email: "" }
  }

  const body = await request.formData()
  return {
    email: String(body.get("email") ?? "")
      .trim()
      .toLowerCase(),
    oauthQuery:
      typeof body.get("oauth_query") === "string"
        ? String(body.get("oauth_query"))
        : undefined,
  }
}

function genericUnauthorized(): Response {
  return Response.json({ error: "Invalid email or password" }, { status: 401 })
}

function existingAccountSignUpResponse(): Response {
  return Response.json(
    { error: "An account already exists for that email. Sign in to continue." },
    { status: 409 },
  )
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
  callbackURL,
  email,
  isFormPost,
  oauthQuery,
}: {
  callbackURL?: string
  email?: string
  isFormPost: boolean
  oauthQuery?: string
}): Response {
  if (!isFormPost) return genericUnauthorized()

  const url = new URL("/login", getAuthBaseUrl())
  if (callbackURL) {
    url.searchParams.set("callbackURL", callbackURL)
  } else if (oauthQuery) {
    url.search = oauthQuery
  }
  url.searchParams.set("error", "credentials")
  if (email) url.searchParams.set("email", email)
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
  consumeInteractivePrompt(url.searchParams)
  return url.toString()
}

/**
 * A device sign-in continues to the approval page, not to `/oauth2/authorize`:
 * the TV already holds its own grant, and the browser's only remaining job is
 * to approve it.
 *
 * The URL is rebuilt from the user code alone rather than forwarding the query,
 * so nothing else a caller put in `oauth_query` can ride along. Returns
 * undefined when there is no usable code, which keeps the ordinary OAuth
 * continuation as the fallback.
 */
function buildDeviceContinuationURL(oauthQuery: string | undefined) {
  if (!oauthQuery) return undefined

  const params = new URLSearchParams(oauthQuery)

  // A device continuation is recognised by a user code AND the absence of an
  // OAuth authorize request. Without the second condition, appending
  // `user_code=` to an ordinary `/login?client_id=…` link would divert that
  // sign-in to the approval page instead of completing its own authorize hop.
  if (params.has("client_id") || params.has("redirect_uri")) return undefined

  const userCode = normalizeUserCode(params.get("user_code") ?? "")
  if (!userCode) return undefined

  const url = new URL("/device", getAuthBaseUrl())
  url.searchParams.set("user_code", userCode)
  return url.toString()
}

function buildContinuationURL(oauthQuery: string | undefined) {
  return (
    buildDeviceContinuationURL(oauthQuery) ??
    buildOAuthContinuationURL(oauthQuery)
  )
}

function buildOAuthLoginURL(oauthQuery: string | undefined) {
  if (!oauthQuery) return undefined

  const url = new URL("/login", getAuthBaseUrl())
  url.search = oauthQuery
  return url.toString()
}

function consumeInteractivePrompt(params: URLSearchParams) {
  const prompt = params.get("prompt")
  if (!prompt) return

  const remainingPrompts = prompt
    .split(/\s+/)
    .filter((value) => value !== "login" && value !== "select_account")

  params.delete("prompt")
  if (remainingPrompts.length > 0) {
    params.set("prompt", remainingPrompts.join(" "))
  }
}

async function parseSocialSignInRequest(request: Request): Promise<{
  body: Record<string, unknown>
  callbackURL?: string
  oauthQuery?: string
}> {
  const body = (await request.json()) as {
    callbackURL?: unknown
    oauth_query?: unknown
    [key: string]: unknown
  }

  return {
    body,
    callbackURL: resolveWebWatchCallbackURL(
      typeof body.callbackURL === "string" ? body.callbackURL : undefined,
    ),
    oauthQuery:
      typeof body.oauth_query === "string" ? body.oauth_query : undefined,
  }
}

async function handleSocialSignIn(request: Request): Promise<Response> {
  const {
    body,
    callbackURL: webCallbackURL,
    oauthQuery,
  } = await parseSocialSignInRequest(request)
  const callbackURL = webCallbackURL ?? buildContinuationURL(oauthQuery)
  const errorCallbackURL = webCallbackURL
    ? undefined
    : buildOAuthLoginURL(oauthQuery)
  const betterAuthBody = { ...body }
  delete betterAuthBody.callbackURL
  delete betterAuthBody.email
  delete betterAuthBody.expected_login_method
  delete betterAuthBody.oauth_query

  return authRouteHandlers.POST(
    toJsonRequest(request, {
      ...betterAuthBody,
      ...(callbackURL ? { callbackURL } : {}),
      ...(errorCallbackURL ? { errorCallbackURL } : {}),
    }),
  )
}

function enabledProviderIds(): Set<LoginProviderId> {
  const providers = new Set<LoginProviderId>()

  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    providers.add("facebook")
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.add("google")
  }
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
    providers.add("apple")
  }
  if (
    process.env.OKTA_CLIENT_ID &&
    process.env.OKTA_CLIENT_SECRET &&
    process.env.OKTA_ISSUER
  ) {
    providers.add("okta")
  }

  return providers
}

async function handleLoginMethod(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "login-method",
    limit: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  })
  if (!limit.allowed) {
    audit("auth.login_method.rejected.rate_limited")
    return Response.json({ method: "password" })
  }

  const { email, oauthQuery } = await parseLoginMethodRequest(request)
  if (!email) {
    audit("auth.login_method.password")
    return Response.json({ method: "password" })
  }

  if (isAgentLoginHandle(email)) {
    const canRedeem = await canRedeemAgentLoginHandle(prisma, {
      handle: email,
      oauthQuery,
    })
    audit(
      canRedeem
        ? "auth.login_method.agent_handle"
        : "auth.login_method.password",
      email,
    )
    return Response.json(
      canRedeem ? { method: "agent-handle" } : { method: "password" },
    )
  }

  const enabledProviders = enabledProviderIds()
  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      accounts: {
        select: { providerId: true },
      },
    },
  })

  const accountProviders =
    user?.accounts
      .map((account) => account.providerId)
      .filter(isLoginProviderId)
      .filter((providerId) => enabledProviders.has(providerId)) ?? []
  const provider = providerPriority.find((providerId) =>
    accountProviders.includes(providerId),
  )

  if (provider) {
    audit("auth.login_method.provider", email)
    return Response.json({ method: "provider", provider })
  }

  audit("auth.login_method.password", email)
  return Response.json({ method: "password" })
}

/**
 * RFC 8628 §5.2 names the device endpoints as a brute-force surface, and the
 * catch-all below hands plugin endpoints straight to better-auth with no limiter
 * of its own. These branches are the only throttle in front of them.
 *
 * This is the per-IP half. It is deliberately paired with a per-code attempt cap
 * in the device grant service: a per-IP bucket alone does not stop a short user
 * code being ground down from many addresses, and a per-code cap alone does not
 * stop an attacker minting unlimited fresh codes.
 */
const DEVICE_RATE_LIMITS: Record<string, { limit: number; windowMs: number }> =
  {
    // Issuance is the expensive side (a row per call), so it is the tighter bucket.
    "device/code": { limit: 12, windowMs: WINDOW_MS },
    // Polling is legitimately frequent: a 15-minute code at a 5s interval is ~180
    // polls. The ceiling sits above that so a well-behaved TV is never throttled.
    "device/token": { limit: 240, windowMs: WINDOW_MS },
    "device/approve": { limit: 10, windowMs: WINDOW_MS },
    "device/deny": { limit: 10, windowMs: WINDOW_MS },
    "device/status": { limit: 20, windowMs: WINDOW_MS },
  }

async function rateLimitDeviceRoute(
  request: Request,
  path: string,
): Promise<Response | undefined> {
  const config = Object.hasOwn(DEVICE_RATE_LIMITS, path)
    ? DEVICE_RATE_LIMITS[path]
    : undefined
  if (!config) return undefined

  const limit = await rateLimitAuthRoute({
    request,
    route: path,
    limit: config.limit,
    windowMs: config.windowMs,
  })
  if (limit.allowed) return undefined

  console.log(`[device] event=rate_limited route=${path}`)
  return Response.json(
    {
      error: "slow_down",
      error_description: "Too many requests. Try again shortly.",
    },
    { status: 429, headers: { "Cache-Control": "no-store" } },
  )
}

/**
 * Force `no-store` onto every device response.
 *
 * The plugin passes these headers to `ctx.json`, but they never reach the wire:
 * better-call@1.3.5's `toResponse` shadows its own `headers` binding inside the
 * branch that copies per-response headers, so it copies the map onto itself and
 * discards it. Measured, not inferred — `/device/token` returned only
 * `content-type` while its body carried an access token and a refresh token.
 *
 * RFC 6749 §5.1 makes `no-store` a MUST on token responses, and `/device/code`
 * and `/device/status` both carry a live user code. Setting it here means the
 * guarantee does not depend on a dependency's header handling.
 */
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  headers.set("Pragma", "no-cache")

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function isDeviceGrantPath(path: string): boolean {
  // Object.hasOwn, not `in`: `in` matches inherited keys, so a request to
  // /api/auth/toString would be treated as a device route.
  return Object.hasOwn(DEVICE_RATE_LIMITS, path)
}

async function enforceAgentOAuthAuthorizePolicy(
  request: Request,
): Promise<Response | undefined> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user?.id) return undefined

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { actorType: true },
  })
  if (user?.actorType !== "AGENT") return undefined

  const clientId = new URL(request.url).searchParams.get("client_id")
  if (!clientId) return new Response("Forbidden", { status: 403 })

  const environment = await prisma.appEnvironment.findUnique({
    where: { clientId },
    select: {
      kind: true,
      status: true,
      app: { select: { status: true } },
      grants: {
        where: {
          status: "APPROVED",
          subjectType: "USER",
          userId: session.user.id,
        },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (
    !environment ||
    environment.kind === "PRODUCTION" ||
    environment.status !== "APPROVED" ||
    environment.app.status !== "ACTIVE" ||
    environment.grants.length === 0
  ) {
    return new Response("Forbidden", { status: 403 })
  }

  return undefined
}

async function handleEmailSignUp(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "sign-up/email",
    limit: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  })
  if (!limit.allowed) {
    audit("auth.signup.rejected.rate_limited")
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  let parsed: Awaited<ReturnType<typeof parseEmailPasswordRequest>>
  try {
    parsed = await parseEmailPasswordRequest(request)
  } catch {
    audit("auth.signup.rejected.public")
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const {
    callbackURL: webCallbackURL,
    email,
    isFormPost,
    oauthQuery,
    password,
  } = parsed
  if (!email) {
    audit("auth.signup.rejected.public")
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  })
  if (existingUser) {
    audit("auth.signup.rejected.existing_account", email)
    return existingAccountSignUpResponse()
  }

  if (await firebaseUserExistsByEmail(email)) {
    audit("auth.signup.rejected.legacy_firebase_account", email)
    return existingAccountSignUpResponse()
  }

  if (!password) {
    audit("auth.signup.rejected.public", email)
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const callbackURL = webCallbackURL ?? buildContinuationURL(oauthQuery)
  const response = await authRouteHandlers.POST(
    toJsonRequest(request, {
      ...(callbackURL ? { callbackURL } : {}),
      email,
      password,
      name: email.split("@")[0] || "user",
    }),
  )

  if (!response.ok) return response

  audit("auth.signup.success", email)
  return isFormPost
    ? withLastLoginMethodCookie(
        redirectFormPostAfterSignIn(response, callbackURL),
        "email",
      )
    : withLastLoginMethodCookie(response, "email")
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

  const {
    callbackURL: webCallbackURL,
    email,
    isFormPost,
    oauthQuery,
    password,
  } = await parseEmailPasswordRequest(request)

  if (!email || !password) {
    audit("auth.signin.rejected", email)
    return rejectEmailSignIn({
      callbackURL: webCallbackURL,
      email,
      isFormPost,
      oauthQuery,
    })
  }
  const callbackURL = webCallbackURL ?? buildContinuationURL(oauthQuery)

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
      ? rejectEmailSignIn({
          callbackURL: webCallbackURL,
          email,
          isFormPost,
          oauthQuery,
        })
      : primaryResponse
  }

  const firebaseSignIn = await signInWithFirebasePassword(email, password)
  if (!firebaseSignIn) {
    audit("auth.signin.rejected", email)
    return rejectEmailSignIn({
      callbackURL: webCallbackURL,
      email,
      isFormPost,
      oauthQuery,
    })
  }

  const verified = await verifyFirebaseIdToken(firebaseSignIn.idToken)
  if (!verified || verified.email.toLowerCase() !== email) {
    audit("auth.firebase.rejected.unverified", email)
    return rejectEmailSignIn({
      callbackURL: webCallbackURL,
      email,
      isFormPost,
      oauthQuery,
    })
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
    return rejectEmailSignIn({
      callbackURL: webCallbackURL,
      email,
      isFormPost,
      oauthQuery,
    })
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
        issuer: "local:firebase",
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
  const deviceLimited = await rateLimitDeviceRoute(request, all.join("/"))
  if (deviceLimited) return deviceLimited

  if (all.join("/") === "oauth2/authorize") {
    const url = new URL(request.url)
    await ensureDynamicPreviewRedirectUriRegistered({
      clientId: url.searchParams.get("client_id"),
      redirectUri: url.searchParams.get("redirect_uri"),
    })
    const agentPolicyResponse = await enforceAgentOAuthAuthorizePolicy(request)
    if (agentPolicyResponse) return agentPolicyResponse
  }

  const response = await authRouteHandlers.GET(request)
  if (isDeviceGrantPath(all.join("/"))) return withNoStore(response)

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

  const deviceLimited = await rateLimitDeviceRoute(request, path)
  if (deviceLimited) return deviceLimited

  if (path === "sign-in/email") {
    return handleEmailSignIn(request)
  }
  if (path === "login-method") {
    return handleLoginMethod(request)
  }
  if (path === "sign-in/social") {
    return handleSocialSignIn(request)
  }
  if (path === "sign-up/email") {
    return handleEmailSignUp(request)
  }
  if (isDeviceGrantPath(path)) {
    return withNoStore(await authRouteHandlers.POST(request))
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
