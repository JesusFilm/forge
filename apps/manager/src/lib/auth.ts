// API route authentication.
// Supports two auth methods:
// 1. Manager-local OAuth session cookie (set by /api/auth/callback)
// 2. Bearer token header (MANAGER_API_KEY) — for external API clients
// Auth is enforced in all environments (dev included).

import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { env } from "@/config/env"
import { validateAdminManagerSession } from "@/lib/admin-manager-session"
import {
  MANAGER_SESSION_COOKIE,
  readManagerSessionCookie,
  type ManagerSessionPrincipal,
} from "@/lib/manager-session-cookie"
import {
  hasReviewerLanguageGrant as hasExactReviewerLanguageGrant,
  type ReviewerLanguageGrant,
} from "@/lib/reviewer-session"

export type ManagerAuthenticatedUser = {
  id: string
  username: string
  email: string
  role: { name: "Manager"; type: "manager" }
}

export type ManagerOverrideActor =
  | {
      kind: "session"
      user: ManagerAuthenticatedUser
      approvedByUserId: string
    }
  | {
      kind: "api_key"
      approvedByUserId: string
    }

export type ManagerInteractiveActor = Extract<
  ManagerOverrideActor,
  { kind: "session" }
>

export type ManagerReviewerSession = ManagerSessionPrincipal & {
  managerRole: "REVIEWER"
  reviewerLanguageGrants: ReviewerLanguageGrant[]
}

export type ManagerReviewerActor = {
  kind: "reviewer_session"
  session: ManagerReviewerSession
}

function isValidManagerApiKey(token: string): boolean {
  const apiKey = env.MANAGER_API_KEY
  if (!apiKey) {
    return false
  }

  const a = Buffer.from(token)
  const b = Buffer.from(apiKey)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function verifyManagerSession(
  token: string,
): Promise<ManagerAuthenticatedUser | null> {
  const session = await readValidatedManagerSessionCookie(token)
  if (!session || session.managerRole !== "OPERATOR") {
    return null
  }

  return toManagerUser(session)
}

export async function verifyReviewerSession(
  token: string,
): Promise<ManagerReviewerSession | null> {
  const session = await readValidatedManagerSessionCookie(token)
  return session?.managerRole === "REVIEWER"
    ? (session as ManagerReviewerSession)
    : null
}

export async function resolveManagerLandingPathForSession(
  token: string,
): Promise<"/dashboard/coverage" | "/subtitle-review" | null> {
  const session = await readValidatedManagerSessionCookie(token)
  if (!session) return null
  return session.managerRole === "REVIEWER"
    ? "/subtitle-review"
    : "/dashboard/coverage"
}

/**
 * Reviewer-only interactive guard. It never accepts MANAGER_API_KEY and uses
 * a non-disclosing 404 for every denial so future assignment/artifact routes
 * do not reveal reviewer or language-bound resource existence.
 */
export async function authenticateInteractiveReviewerRequest(
  request: Request,
): Promise<ManagerReviewerActor | NextResponse> {
  const session = await readAnySessionFromCookieHeader(
    request.headers.get("cookie"),
  )
  if (session?.managerRole !== "REVIEWER") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return {
    kind: "reviewer_session",
    session: session as ManagerReviewerSession,
  }
}

/** Exact Admin Language.id + Language.slug authorization; never BCP-47. */
export function hasReviewerLanguageGrant(
  session: Pick<ManagerReviewerSession, "reviewerLanguageGrants">,
  languageId: string,
  languageSlug: string,
): boolean {
  return hasExactReviewerLanguageGrant(
    session.reviewerLanguageGrants,
    languageId,
    languageSlug,
  )
}

export async function authenticateRequest(
  request: Request,
): Promise<NextResponse | null> {
  // Check Bearer token first (for API clients)
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (isValidManagerApiKey(token)) {
      return null // Authenticated via API key
    }
  }

  const session = await readSessionFromCookieHeader(
    request.headers.get("cookie"),
  )
  if (session) {
    return null
  }

  return NextResponse.json(
    { error: "Authentication required" },
    { status: 401 },
  )
}

export function authenticateServiceBearerRequest(
  request: Request,
): NextResponse | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (isValidManagerApiKey(token)) {
      return null
    }
  }

  return NextResponse.json(
    { error: "Service bearer token required" },
    { status: 403 },
  )
}

export async function authenticateInteractiveManagerRequest(
  request: Request,
): Promise<ManagerInteractiveActor | NextResponse> {
  const session = await readSessionFromCookieHeader(
    request.headers.get("cookie"),
  )
  if (!session) {
    const hasBearer = request.headers
      .get("authorization")
      ?.startsWith("Bearer ")
    return NextResponse.json(
      {
        error: hasBearer
          ? "Interactive Manager session required; service keys cannot perform this action"
          : "Interactive Manager session required",
      },
      { status: hasBearer ? 403 : 401 },
    )
  }

  return {
    kind: "session",
    user: toManagerUser(session),
    approvedByUserId: session.id,
  }
}

export async function authenticateManagerOverrideRequest(
  request: Request,
): Promise<ManagerOverrideActor | NextResponse> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (isValidManagerApiKey(token)) {
      return {
        kind: "api_key",
        approvedByUserId: "service:manager-api-key",
      }
    }

    return NextResponse.json(
      { error: "Interactive Manager session or API key required" },
      { status: 403 },
    )
  }

  const session = await readSessionFromCookieHeader(
    request.headers.get("cookie"),
  )
  if (!session) {
    return NextResponse.json(
      { error: "Interactive Manager session or API key required" },
      { status: 403 },
    )
  }

  return {
    kind: "session",
    user: toManagerUser(session),
    approvedByUserId: session.id,
  }
}

// Display identity for audit fields derived from the authenticated actor
// (NEVER the request body): the session user's email when available, the
// stable user id otherwise, and the service principal for API-key callers.
// Extracted from the smart-crop approve route's inline pattern so the shorts
// routes (create requestedBy, draft updatedBy, render launch log) share one
// definition.
export function managerActorIdentity(actor: ManagerOverrideActor): string {
  return actor.kind === "session"
    ? actor.user.email || actor.approvedByUserId
    : actor.approvedByUserId
}

async function readSessionFromCookieHeader(
  cookieHeader: string | null,
): Promise<ManagerSessionPrincipal | null> {
  const session = await readAnySessionFromCookieHeader(cookieHeader)
  return session?.managerRole === "OPERATOR" ? session : null
}

async function readAnySessionFromCookieHeader(
  cookieHeader: string | null,
): Promise<ManagerSessionPrincipal | null> {
  const token = readCookie(cookieHeader, MANAGER_SESSION_COOKIE)
  return readValidatedManagerSessionCookie(token)
}

async function readValidatedManagerSessionCookie(
  token?: string,
): Promise<ManagerSessionPrincipal | null> {
  const session = await readManagerSessionCookie(token)
  if (!session) {
    return null
  }

  if (isMockManagerMode()) {
    return session
  }

  try {
    const adminSession = await validateAdminManagerSession({
      subject: session.subject,
      email: session.email,
      name: session.name,
    })

    if (!adminSession) {
      return null
    }

    return {
      ...session,
      id: adminSession.user.id,
      email: adminSession.user.email,
      name: adminSession.user.name ?? session.name,
      managerRole: adminSession.managerRole,
      reviewerLanguageGrants: adminSession.reviewerLanguageGrants,
    }
  } catch (error) {
    console.warn("manager.auth.session_validation_failed", {
      message: error instanceof Error ? error.message : "unknown",
    })

    return null
  }
}

function isMockManagerMode() {
  return (env.MANAGER_BACKEND_MODE ?? env.MANAGER_DATA_MODE) === "mock"
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function toManagerUser(
  session: ManagerSessionPrincipal,
): ManagerAuthenticatedUser {
  return {
    id: session.id,
    username: session.name ?? session.email,
    email: session.email,
    role: { name: "Manager", type: "manager" },
  }
}
