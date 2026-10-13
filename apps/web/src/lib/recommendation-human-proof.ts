import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"
import type { NextResponse } from "next/server"
import { WATCH_RECOMMENDATION_TURNSTILE_ACTION } from "./recommendation-turnstile"

const PROOF_CONTEXT = "forge-watch-human-v1."
const BROWSER_CONTEXT = "forge-watch-human-browser-v1."
const MAX_AGE_SECONDS = 300
const COOKIE = "forge_watch_recommendation_verified_browser"
const COOKIE_PATH = "/watch/api/recommendations"
const BASE64URL = /^[A-Za-z0-9_-]+$/
const DIGEST = /^[a-f0-9]{64}$/

export type WatchHumanProofBinding = {
  visitId: string
  browserDigest: string
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
}

function mac(secret: string, context: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update(context + encoded, "ascii")
    .digest("base64url")
}

function signedEnvelope(
  context: string,
  payload: Record<string, string | number>,
  secret: string,
): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  )
  return `v1.${encoded}.${mac(secret, context, encoded)}`
}

function readSignedEnvelope(
  context: string,
  value: string | null,
  secret: string,
): Record<string, unknown> | null {
  if (!value || value.length > 1_024) return null
  const parts = value.split(".")
  if (
    parts.length !== 3 ||
    parts[0] !== "v1" ||
    !parts[1] ||
    !parts[2] ||
    !BASE64URL.test(parts[1]) ||
    !BASE64URL.test(parts[2])
  )
    return null
  const actual = Buffer.from(parts[2], "ascii")
  const expected = Buffer.from(mac(secret, context, parts[1]), "ascii")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    )
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function validTimes(
  issuedAt: unknown,
  expiresAt: unknown,
  nowSeconds: number,
): issuedAt is number {
  return (
    Number.isInteger(issuedAt) &&
    Number.isInteger(expiresAt) &&
    typeof issuedAt === "number" &&
    typeof expiresAt === "number" &&
    issuedAt <= nowSeconds + 30 &&
    expiresAt > nowSeconds &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= MAX_AGE_SECONDS
  )
}

export function createWatchHumanBrowserGrant(
  browserDigest: string,
  hostname: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): string | null {
  if (secret.length < 32 || !DIGEST.test(browserDigest) || !hostname)
    return null
  return signedEnvelope(
    BROWSER_CONTEXT,
    {
      browserDigest,
      hostname,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + MAX_AGE_SECONDS,
    },
    secret,
  )
}

export function readWatchHumanBrowserGrant(
  request: Request,
  browserDigest: string,
  secret: string | undefined,
  allowedHostnames: readonly string[],
  nowSeconds = Math.floor(Date.now() / 1_000),
): { hostname: string; issuedAt: number; expiresAt: number } | null {
  if (!secret || secret.length < 32 || !DIGEST.test(browserDigest)) return null
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([name]) => name === COOKIE)
    .map(([, value]) => value)
  if (values.length !== 1) return null
  const payload = readSignedEnvelope(BROWSER_CONTEXT, values[0] ?? null, secret)
  if (
    !payload ||
    payload.browserDigest !== browserDigest ||
    typeof payload.hostname !== "string" ||
    !allowedHostnames.includes(payload.hostname) ||
    !validTimes(payload.issuedAt, payload.expiresAt, nowSeconds)
  )
    return null
  return {
    hostname: payload.hostname,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt as number,
  }
}

export function createWatchHumanVerificationReceipt(
  binding: WatchHumanProofBinding,
  grant: { hostname: string; issuedAt: number; expiresAt: number },
  secret: string,
): string | null {
  if (secret.length < 32 || !DIGEST.test(binding.browserDigest)) return null
  return signedEnvelope(
    PROOF_CONTEXT,
    {
      ...binding,
      action: WATCH_RECOMMENDATION_TURNSTILE_ACTION,
      hostname: grant.hostname,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
    },
    secret,
  )
}

export function attachWatchHumanBrowserGrant(
  response: NextResponse,
  value: string,
) {
  response.cookies.set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: MAX_AGE_SECONDS,
  })
}
