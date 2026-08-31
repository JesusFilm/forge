import { createHash, randomBytes } from "node:crypto"
import type { NextResponse } from "next/server"

export const RECOMMENDATION_CONSENT_CONTRACT =
  "recommendation-consent-v1" as const
export const RECOMMENDATION_CONSENT_COOKIE =
  "forge_recommendation_consent" as const
export const RECOMMENDATION_CONSENT_CHANGED_EVENT =
  "forge:recommendation-consent-changed" as const
export const RECOMMENDATION_CONSENT_CHANNEL =
  "forge-recommendation-consent-v1" as const
export const RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT =
  "forge:recommendation-cookie-settings-open" as const

const RECEIPT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60
const RECEIPT_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type RecommendationConsentCookie = Readonly<{
  value: string
  digest: string
}>

export type RecommendationConsentCookieRead =
  | { kind: "absent" }
  | { kind: "invalid" }
  | ({ kind: "valid" } & RecommendationConsentCookie)

function cookieValues(request: Request): string[] {
  const cookie = request.headers.get("cookie")
  if (!cookie) return []
  return cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([name, value]) => name === RECOMMENDATION_CONSENT_COOKIE && value)
    .map(([, value]) => value!)
}

export function readRecommendationConsentCookie(
  request: Request,
): RecommendationConsentCookieRead {
  const values = cookieValues(request)
  if (values.length === 0) return { kind: "absent" }
  if (values.length !== 1 || !RECEIPT_VALUE_PATTERN.test(values[0]!)) {
    return { kind: "invalid" }
  }
  const value = values[0]!
  return {
    kind: "valid",
    value,
    digest: createHash("sha256").update(value).digest("hex"),
  }
}

export function createRecommendationConsentCookie(): RecommendationConsentCookie {
  const value = randomBytes(32).toString("base64url")
  return {
    value,
    digest: createHash("sha256").update(value).digest("hex"),
  }
}

export function attachRecommendationConsent(
  response: NextResponse,
  receipt: RecommendationConsentCookie,
): void {
  response.cookies.set(RECOMMENDATION_CONSENT_COOKIE, receipt.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: RECEIPT_MAX_AGE_SECONDS,
  })
}

export function clearRecommendationConsent(response: NextResponse): void {
  response.cookies.set(RECOMMENDATION_CONSENT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  })
}
