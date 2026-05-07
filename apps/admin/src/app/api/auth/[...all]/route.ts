import { createHash, randomUUID } from "node:crypto"
import { auth, authRouteHandlers } from "@/auth/config"
import { signInWithFirebasePassword } from "@/auth/firebase-rest"
import { verifyFirebaseIdToken } from "@/auth/firebase-admin"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isTrustedAuthOrigin } from "@/auth/origins"
import { env } from "@/config/env"
import { prisma } from "@/db/client"

type RouteContext = {
  params: Promise<{ all?: string[] }>
}

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function audit(event: string, email?: string): void {
  console.log(
    JSON.stringify({
      event,
      emailHash: email ? sha256(email.trim().toLowerCase()) : undefined,
      service: "forge-admin",
    }),
  )
}

function cutoffReached(): boolean {
  if (!env.FIREBASE_MIGRATION_CUTOFF_AT) {
    return false
  }
  return Date.now() >= new Date(env.FIREBASE_MIGRATION_CUTOFF_AT).getTime()
}

async function parseEmailPasswordRequest(
  request: Request,
): Promise<{ email: string; password: string; callbackURL?: string }> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      callbackURL?: string
      email?: string
      password?: string
    }
    return {
      email: body.email?.trim().toLowerCase() ?? "",
      password: body.password ?? "",
      callbackURL: body.callbackURL,
    }
  }

  const body = await request.formData()
  return {
    email: String(body.get("email") ?? "")
      .trim()
      .toLowerCase(),
    password: String(body.get("password") ?? ""),
    callbackURL:
      typeof body.get("callbackURL") === "string"
        ? String(body.get("callbackURL"))
        : undefined,
  }
}

function genericUnauthorized(): Response {
  return Response.json({ error: "Invalid email or password" }, { status: 401 })
}

function authCorsHeaders(request: Request): Headers {
  const headers = new Headers()
  const origin = request.headers.get("origin")
  if (!origin || !isTrustedAuthOrigin(origin)) {
    return headers
  }

  headers.set("access-control-allow-origin", origin)
  headers.set("access-control-allow-credentials", "true")
  headers.set("vary", "Origin")
  return headers
}

function withAuthCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of authCorsHeaders(request)) {
    headers.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
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

async function handleEmailSignIn(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "sign-in/email",
    limit: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  })
  if (!limit.allowed) {
    audit("auth.firebase.rejected.rate_limited")
    return withAuthCors(request, genericUnauthorized())
  }

  const { email, password, callbackURL } =
    await parseEmailPasswordRequest(request)
  if (!email || !password) {
    audit("auth.signin.rejected", email)
    return withAuthCors(request, genericUnauthorized())
  }

  const jsonBody = { email, password, ...(callbackURL ? { callbackURL } : {}) }
  const primaryResponse = await authRouteHandlers.POST(
    toJsonRequest(request, jsonBody),
  )
  if (primaryResponse.ok || primaryResponse.status !== 401) {
    if (primaryResponse.ok) {
      audit("auth.signin.success")
    }
    return withAuthCors(request, primaryResponse)
  }

  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  })
  if (existingUser) {
    audit("auth.signin.rejected", email)
    return withAuthCors(request, primaryResponse)
  }

  if (cutoffReached()) {
    audit("auth.firebase.rejected.cutoff", email)
    return withAuthCors(request, genericUnauthorized())
  }

  const firebaseSignIn = await signInWithFirebasePassword(email, password)
  if (!firebaseSignIn) {
    audit("auth.signin.rejected", email)
    return withAuthCors(request, genericUnauthorized())
  }

  const verified = await verifyFirebaseIdToken(firebaseSignIn.idToken)
  if (!verified || verified.email.toLowerCase() !== email) {
    audit("auth.firebase.rejected.unverified", email)
    return withAuthCors(request, genericUnauthorized())
  }

  const signUpResponse = await auth.api.signUpEmail({
    headers: request.headers,
    asResponse: true,
    body: {
      email,
      password,
      callbackURL,
      name: email.split("@")[0] || "editor",
    },
  })

  if (!signUpResponse.ok) {
    audit("auth.signin.rejected", email)
    return withAuthCors(request, genericUnauthorized())
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
      data: { emailVerified: true },
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
  return withAuthCors(request, signUpResponse)
}

export async function GET(request: Request): Promise<Response> {
  return withAuthCors(request, await authRouteHandlers.GET(request))
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
  return withAuthCors(request, await authRouteHandlers.POST(request))
}

export async function OPTIONS(request: Request): Promise<Response> {
  const headers = authCorsHeaders(request)
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
  return withAuthCors(request, await authRouteHandlers.PATCH(request))
}

export async function PUT(request: Request): Promise<Response> {
  return withAuthCors(request, await authRouteHandlers.PUT(request))
}

export async function DELETE(request: Request): Promise<Response> {
  return withAuthCors(request, await authRouteHandlers.DELETE(request))
}
