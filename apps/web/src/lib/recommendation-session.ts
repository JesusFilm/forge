import { createHash, randomBytes } from "node:crypto"
import type { NextResponse } from "next/server"
import { readRecommendationConsentCookie } from "./recommendation-consent"

export const RECOMMENDATION_SESSION_COOKIE =
  "forge_recommendation_session" as const
export const RECOMMENDATION_PROFILE_COOKIE =
  "forge_recommendation_profile" as const
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60
const PROFILE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60
const SESSION_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type RecommendationSession = {
  value: string
  digest: string
  fresh: boolean
}

function cookieValues(request: Request, cookieName: string): string[] {
  const cookie = request.headers.get("cookie")
  if (!cookie) return []
  return cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([name, value]) => name === cookieName && value)
    .map(([, value]) => value!)
}

export function digestRecommendationValue(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function readRecommendationSession(
  request: Request,
): RecommendationSession | null {
  const values = cookieValues(request, RECOMMENDATION_SESSION_COOKIE)
  if (values.length !== 1 || !SESSION_VALUE_PATTERN.test(values[0]!)) {
    return null
  }
  return {
    value: values[0]!,
    digest: digestRecommendationValue(values[0]!),
    fresh: false,
  }
}

export type RecommendationProfileCookie = {
  value: string
  digest: string
}

export type RecommendationProfileCookieRead =
  | { kind: "absent" }
  | { kind: "invalid" }
  | ({ kind: "valid" } & RecommendationProfileCookie)

export function readRecommendationProfileCookie(
  request: Request,
): RecommendationProfileCookieRead {
  const consent = readRecommendationConsentCookie(request)
  if (consent.kind === "valid" && consent.profileValue != null) {
    return {
      kind: "valid",
      value: consent.profileValue,
      digest: digestRecommendationValue(consent.profileValue),
    }
  }
  const values = cookieValues(request, RECOMMENDATION_PROFILE_COOKIE)
  if (values.length === 0) return { kind: "absent" }
  if (values.length !== 1 || !SESSION_VALUE_PATTERN.test(values[0]!)) {
    return { kind: "invalid" }
  }
  return {
    kind: "valid",
    value: values[0]!,
    digest: digestRecommendationValue(values[0]!),
  }
}

export function createRecommendationProfileCookie(): RecommendationProfileCookie {
  const value = randomBytes(32).toString("base64url")
  return { value, digest: digestRecommendationValue(value) }
}

export function ensureRecommendationSession(
  request: Request,
): RecommendationSession {
  const existing = readRecommendationSession(request)
  if (existing) return existing
  const value = randomBytes(32).toString("base64url")
  return { value, digest: digestRecommendationValue(value), fresh: true }
}

export function attachRecommendationSession(
  response: NextResponse,
  session: RecommendationSession,
): void {
  if (!session.fresh) return
  response.cookies.set(RECOMMENDATION_SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export function attachRecommendationProfile(
  response: NextResponse,
  profile: RecommendationProfileCookie,
): void {
  response.cookies.set(RECOMMENDATION_PROFILE_COOKIE, profile.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PROFILE_MAX_AGE_SECONDS,
  })
}

export function clearRecommendationProfile(response: NextResponse): void {
  response.cookies.set(RECOMMENDATION_PROFILE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}
