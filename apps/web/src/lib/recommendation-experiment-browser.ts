import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
import type { NextResponse } from "next/server"

export const RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE =
  "forge_recommendation_experiment_browser"
const PATH = "/watch/api/recommendations"
const MAX_AGE = 180 * 86_400
const VALUE = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/

function signature(raw: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`precomputed-browser-v1\0${raw}`)
    .digest("base64url")
}

function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

export function createRecommendationExperimentBrowser(
  secret: string,
  credential?: {
    consentReceiptDigest: string
    profileTokenDigest: string
  },
) {
  if (secret.length < 32) return null
  const raw = credential
    ? createHmac("sha256", secret)
        .update(
          `precomputed-browser-from-consent-v1\0${credential.consentReceiptDigest}\0${credential.profileTokenDigest}`,
        )
        .digest("base64url")
    : randomBytes(32).toString("base64url")
  return { value: `v1.${raw}.${signature(raw, secret)}`, digest: digest(raw) }
}

export function readRecommendationExperimentBrowser(
  request: Request,
  secret: string | undefined,
): { value: string; digest: string } | null {
  if (!secret || secret.length < 32) return null
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([name]) => name === RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE)
    .map(([, value]) => value)
  if (values.length !== 1 || !values[0]) return null
  const match = VALUE.exec(values[0])
  if (!match) return null
  const expected = Buffer.from(signature(match[1]!, secret))
  const supplied = Buffer.from(match[2]!)
  if (!timingSafeEqual(expected, supplied)) return null
  return { value: values[0], digest: digest(match[1]!) }
}

export function attachRecommendationExperimentBrowser(
  response: NextResponse,
  browser: { value: string },
) {
  response.cookies.set(
    RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE,
    browser.value,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: PATH,
      maxAge: MAX_AGE,
    },
  )
}

export function clearRecommendationExperimentBrowser(response: NextResponse) {
  response.cookies.set(RECOMMENDATION_EXPERIMENT_BROWSER_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: PATH,
    maxAge: 0,
  })
}
