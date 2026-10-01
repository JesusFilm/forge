import "server-only"

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { cookies, headers } from "next/headers"

import { requireConfig } from "./config"
import {
  activeGrantForSession,
  claimGrant,
  type Grant,
  grantForSecret,
  sessionForId,
  type Session,
} from "./feedbackState"
import { key, rateLimit, redis } from "./redis"
import { grantMode } from "./tvGrant"

const COOKIE = "watch_tv_feedback"
const RETENTION_SECONDS = 7 * 24 * 60 * 60

function digest(value: string): string {
  return createHmac(
    "sha256",
    requireConfig("FEEDBACK_SESSION_SECRET").FEEDBACK_SESSION_SECRET,
  )
    .update(value)
    .digest("hex")
}

async function setSessionCookie(
  id: string,
  token: string,
  expiresAt: number,
): Promise<void> {
  ;(await cookies()).set(COOKIE, `${id}.${token}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/feedback",
    maxAge: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
  })
}

function newSession(grantId: string): { session: Session; token: string } {
  const token = randomBytes(32).toString("base64url")
  return {
    token,
    session: {
      id: randomUUID(),
      secretHash: digest(token),
      grantId,
      expiresAt: Date.now() + 30 * 60_000,
      admittedBytes: 0,
      images: 0,
      videos: 0,
      reservations: 0,
    },
  }
}

export async function createSession(): Promise<string> {
  if (process.env.NODE_ENV === "production" || grantMode() === "enforce")
    throw new Error("grant_required")
  const ip = (await headers()).get("x-real-ip") ?? "unknown"
  if (!(await rateLimit("preview-session", digest(ip), 12, 3600)))
    throw new Error("rate_limited")
  const grantId = randomUUID()
  const { session, token } = newSession(grantId)
  const grant: Grant = {
    id: grantId,
    installationId: session.id,
    day: new Date().toISOString().slice(0, 10),
    reference: "LOCAL-PREVIEW",
    expiresAt: session.expiresAt,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
  }
  await redis()
    .multi()
    .set(key("grant", grantId), JSON.stringify(grant), "EX", RETENTION_SECONDS)
    .set(
      key("session", session.id),
      JSON.stringify(session),
      "EX",
      RETENTION_SECONDS,
    )
    .hset(key("daily", `${session.id}:${grant.day}`), "issued", 1)
    .expire(key("daily", `${session.id}:${grant.day}`), RETENTION_SECONDS)
    .exec()
  await setSessionCookie(session.id, token, session.expiresAt)
  return session.id
}

export async function createClaimedSession(
  secretHash: string,
): Promise<{ sessionId: string; expiresAt: Date; reference: string }> {
  const ip = (await headers()).get("x-real-ip") ?? "unknown"
  if (!(await rateLimit("claim-session", digest(ip), 12, 3600)))
    throw new Error("rate_limited")
  const found = await grantForSecret(secretHash)
  if (!found) throw new Error("invalid_or_expired_code")
  const { session, token } = newSession(found.id)
  const claimed = await claimGrant(secretHash, session)
  if ("error" in claimed) throw new Error(claimed.error)
  await setSessionCookie(
    session.id,
    token,
    claimed.grant.sessionExpiresAt ?? session.expiresAt,
  )
  return {
    sessionId: session.id,
    expiresAt: new Date(claimed.grant.sessionExpiresAt ?? session.expiresAt),
    reference: claimed.grant.reference,
  }
}

export async function currentSession(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value
  if (!raw) return null
  const [id, token] = raw.split(".")
  if (!id || !token || !/^[0-9a-f-]{36}$/.test(id) || token.length > 100)
    return null
  const session = await sessionForId(id)
  if (!session || session.expiresAt <= Date.now()) return null
  const actual = Buffer.from(digest(token), "hex")
  const expected = Buffer.from(session.secretHash, "hex")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? id
    : null
}

export async function sessionGrant(id: string): Promise<Grant | null> {
  return activeGrantForSession(id)
}

export async function isSameOrigin(request: Request): Promise<boolean> {
  const origin = request.headers.get("origin")
  const base = requireConfig("FEEDBACK_BASE_URL").FEEDBACK_BASE_URL
  return origin === new URL(base).origin
}
