import { createHash, randomUUID } from "node:crypto"

import { auth, authRouteHandlers } from "@/auth/config"
import { verifyFirebaseIdToken } from "@/auth/firebase-admin"
import { signInWithFirebasePassword } from "@/auth/firebase-rest"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { prisma } from "@/db/client"
import { ensureDynamicPreviewRedirectUriRegistered } from "@/services/dynamic-preview-redirect.service"

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
      service: "forge-auth",
    }),
  )
}

async function parseEmailPasswordRequest(
  request: Request,
): Promise<{ email: string; password: string; oauthQuery?: string }> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      email?: string
      oauth_query?: string
      password?: string
    }
    return {
      email: body.email?.trim().toLowerCase() ?? "",
      oauthQuery: body.oauth_query,
      password: body.password ?? "",
    }
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
    password: String(body.get("password") ?? ""),
  }
}

function genericUnauthorized(): Response {
  return Response.json({ error: "Invalid email or password" }, { status: 401 })
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
    return genericUnauthorized()
  }

  const { email, oauthQuery, password } =
    await parseEmailPasswordRequest(request)
  if (!email || !password) {
    audit("auth.signin.rejected", email)
    return genericUnauthorized()
  }

  const jsonBody = {
    email,
    password,
    ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
  }
  const primaryResponse = await authRouteHandlers.POST(
    toJsonRequest(request, jsonBody),
  )
  if (primaryResponse.ok || primaryResponse.status !== 401) {
    if (primaryResponse.ok) {
      audit("auth.signin.success")
    }
    return primaryResponse
  }

  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  })
  if (existingUser) {
    audit("auth.signin.rejected", email)
    return primaryResponse
  }

  const firebaseSignIn = await signInWithFirebasePassword(email, password)
  if (!firebaseSignIn) {
    audit("auth.signin.rejected", email)
    return genericUnauthorized()
  }

  const verified = await verifyFirebaseIdToken(firebaseSignIn.idToken)
  if (!verified || verified.email.toLowerCase() !== email) {
    audit("auth.firebase.rejected.unverified", email)
    return genericUnauthorized()
  }

  const signUpResponse = await auth.api.signUpEmail({
    headers: request.headers,
    asResponse: true,
    body: {
      email,
      password,
      ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      name: email.split("@")[0] || "user",
    },
  })

  if (!signUpResponse.ok) {
    audit("auth.signin.rejected", email)
    return genericUnauthorized()
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
  return signUpResponse
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

  return authRouteHandlers.GET(request)
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
