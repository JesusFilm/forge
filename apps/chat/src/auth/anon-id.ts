import { chatSessionCookieOptions, type ChatIdentity } from "./session-cookie"
import { chatAuthCookiePrefix } from "@/config/env"

/**
 * Anonymous continuity id for Seeker memory keying (feat-208). The proxy
 * resolves every send to a server-side `resourceId`: `user:<sub>` when signed
 * in, else `anon:<uuid>` from this cookie. The prefix namespacing makes an
 * anon-cookie value colliding with an OIDC sub unrepresentable, and consumers
 * must only ever prefix-check resources (startsWith) — never split on ":".
 *
 * The cookie is minted on first message send (never on page view), value
 * validated as a UUID on every read (anything else is discarded + re-minted),
 * and RE-SET with a fresh Max-Age on every send so its lifetime rolls with the
 * 30-day anonymous retention window — an anonymous user active past day 30
 * keeps both threads and cookie. NOTE: this identity is a memory partition
 * key only and must never gate authorization (R7). Unlike the session's
 * claims — which since feat-233 carry ONE bounded carve-out (the seeker
 * dogfood gate, R13; see src/lib/seeker-gate.ts) — the anon id has no
 * gating carve-out of any kind.
 */

const prefix = chatAuthCookiePrefix()
export const CHAT_ANON_ID_COOKIE = `${prefix}_anon_id`

/** Aligned with the ai-chat anonymous retention window (30 days). */
export const ANON_ID_TTL_SECONDS = 30 * 24 * 60 * 60

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether `value` is a well-formed anon id (a v4-shaped UUID). Security-
 * relevant: the ONLY gate deciding whether a client-settable cookie value is
 * trusted as the anon resource or discarded and re-minted — anything that is
 * not a bare UUID (an injected `user:<sub>`, a cookie-attribute smuggle) fails.
 */
export function isValidAnonId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/**
 * Minimal cookie-header lookup (first match wins), no decoding surprises.
 * Deliberately does NOT `decodeURIComponent` the value (anon ids are bare
 * UUIDs) — this diverges on purpose from `readRequestCookie` in
 * `src/auth/session-cookie.ts`, which decodes because it can carry a URL.
 * Keep the two in sync only if the anon cookie ever needs percent-decoding.
 */
export function getCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * Serialize the anon-id Set-Cookie header: the session cookie's hardening
 * (HttpOnly, SameSite=Lax, Secure in prod, host-only, Path=/) with the rolling
 * 30-day Max-Age.
 */
export function serializeAnonIdCookie(value: string): string {
  const opts = chatSessionCookieOptions()
  const parts = [
    `${CHAT_ANON_ID_COOKIE}=${value}`,
    `Path=${opts.path}`,
    `Max-Age=${ANON_ID_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (opts.secure) parts.push("Secure")
  return parts.join("; ")
}

export type SeekerResourceResolution = {
  /** The namespaced memory resource the proxy sends upstream. */
  resourceId: string
  /** When set, the anon id to (re-)issue via Set-Cookie on this response. */
  anonIdToSet?: string
}

/**
 * Resolve one send's memory resource. Signed-in → `user:<sub>` (no anon
 * cookie churn). Anonymous → `anon:<uuid>`: a valid existing cookie value is
 * reused AND re-issued (rolling lifetime); a missing or invalid value is
 * replaced by a freshly minted UUID.
 */
export function resolveSeekerResource({
  identity,
  anonCookieValue,
  mintId = () => crypto.randomUUID(),
}: {
  identity: Pick<ChatIdentity, "sub"> | null
  anonCookieValue: string | undefined
  mintId?: () => string
}): SeekerResourceResolution {
  // A verified session with a non-empty sub keys to that user's partition. An
  // empty/blank sub (a malformed token) must NOT collapse every such user onto
  // the bare `user:` partition — fall through to an anon id instead (defense in
  // depth; readChatSessionCookie already rejects an empty sub upstream).
  if (identity !== null && identity.sub.trim().length > 0) {
    return { resourceId: `user:${identity.sub}` }
  }
  const anonId = isValidAnonId(anonCookieValue) ? anonCookieValue : mintId()
  return { resourceId: `anon:${anonId}`, anonIdToSet: anonId }
}
