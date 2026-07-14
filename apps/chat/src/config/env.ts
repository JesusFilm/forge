// Chat's first validated env surface (feat-205): the Seeker enable flag + Mastra
// base URL/bearer/allowlist/timeout. EVERY var is optional so a default-off
// deploy boots clean. Mirrors apps/mastra/src/config/env.ts (zod + string-bool).

import { z } from "zod"

// Railway/Doppler can inject an empty string for an unset var; treat "" as absent
// so optional vars stay truly optional rather than failing a non-empty refinement.
const emptyToUndefined = (value: string | undefined) =>
  value === undefined || value === "" ? undefined : value

const DEFAULT_TIMEOUT_MS = 95000
// The route's 90s chatTurn ceiling. The proxy timeout should sit ABOVE this so a
// route-side timeout relays a clean `timeout` (KTD4). Lowering below it is a
// documented escape hatch (Railway stream cap), so we WARN, never clamp.
const ROUTE_CEILING_MS = 90000

/**
 * Chat auth (feat-207). The exact placeholder shipped in .env.example, single-
 * sourced here so chatAuthConfigured() rejects it AND the two can't drift (a
 * copy-paste deploy that leaves the placeholder in place would otherwise sign
 * real sessions with a guessable secret, defeating R11). A test asserts the
 * .env.example line matches this literal.
 */
export const CHAT_SESSION_SECRET_PLACEHOLDER =
  "replace-with-a-long-random-secret-min-32-chars"
// R11 fail-closed threshold: a real signing secret is at least this long.
const MIN_SESSION_SECRET_LENGTH = 32
export const DEFAULT_CHAT_AUTH_COOKIE_PREFIX = "forge_chat"

const envSchema = z.object({
  // Deploy environment. Drives Secure-cookie + localhost-default decisions on
  // the auth path (U4/U5). Optional so the default-off boot never depends on it.
  NODE_ENV: z.string().optional(),
  // string-boolean (repo convention): only the literal "true" enables Seeker.
  SEEKER_CHAT_ENABLED: z.string().optional(),
  SEEKER_MASTRA_BASE_URL: z.string().optional(),
  // CSV SSRF allowlist; unset → operator-set base host trusted (redirect:"error"
  // still guards). Matches admin's hostAllowed.
  SEEKER_MASTRA_ALLOWED_HOSTS: z.string().optional(),
  // The ai-chat lane bearer (Mastra's AI_CHAT_SERVICE_API_KEYS CSV) — since
  // feat-250 the ONLY bearer chat presents: sends AND the history proxies.
  // Optional + fail-closed: unset → config_missing / history refusal.
  AI_CHAT_MASTRA_API_KEY: z.string().optional(),
  // Kept as a raw string here (NOT z.coerce.number): a non-numeric value must
  // NOT crash envSchema.parse() at module load — that would break the
  // "every var optional, boots clean" guarantee. seekerTimeoutMs() does the
  // tolerant numeric parse + positivity guard + fallback.
  SEEKER_TIMEOUT_MS: z.string().optional(),

  // Chat auth (feat-207) — ALL optional so a default-off deploy boots clean;
  // the whole feature is gated behind chatAuthConfigured(). Names mirror admin's
  // (AUTH_ISSUER_URL / AUTH_ADMIN_CLIENT_ID / AUTH_COOKIE_PREFIX).
  AUTH_ISSUER_URL: z.string().optional(),
  AUTH_CHAT_CLIENT_ID: z.string().optional(),
  AUTH_CHAT_CLIENT_SECRET: z.string().optional(),
  CHAT_BASE_URL: z.string().optional(),
  // Cookie-signing secret. R11's signature-verified-on-read rides on this;
  // chatAuthConfigured() rejects an absent, placeholder, or too-short value and
  // the cookie helpers fail closed to anonymous (U4).
  CHAT_SESSION_SECRET: z.string().optional(),
  AUTH_COOKIE_PREFIX: z.string().optional(),

  // Seeker dogfood allowlist (feat-233 gate, env-var mechanism) — CSV of the
  // emails allowed through the per-user seeker gate. Optional and fail-closed:
  // unset or empty admits no one (the kill switch still composes on top).
  SEEKER_ALLOWED_EMAILS: z.string().optional(),
})

export const env = envSchema.parse({
  NODE_ENV: emptyToUndefined(process.env.NODE_ENV),
  SEEKER_CHAT_ENABLED: emptyToUndefined(process.env.SEEKER_CHAT_ENABLED),
  SEEKER_MASTRA_BASE_URL: emptyToUndefined(process.env.SEEKER_MASTRA_BASE_URL),
  SEEKER_MASTRA_ALLOWED_HOSTS: emptyToUndefined(
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS,
  ),
  AI_CHAT_MASTRA_API_KEY: emptyToUndefined(process.env.AI_CHAT_MASTRA_API_KEY),
  SEEKER_TIMEOUT_MS: emptyToUndefined(process.env.SEEKER_TIMEOUT_MS),
  AUTH_ISSUER_URL: emptyToUndefined(process.env.AUTH_ISSUER_URL),
  AUTH_CHAT_CLIENT_ID: emptyToUndefined(process.env.AUTH_CHAT_CLIENT_ID),
  AUTH_CHAT_CLIENT_SECRET: emptyToUndefined(
    process.env.AUTH_CHAT_CLIENT_SECRET,
  ),
  CHAT_BASE_URL: emptyToUndefined(process.env.CHAT_BASE_URL),
  CHAT_SESSION_SECRET: emptyToUndefined(process.env.CHAT_SESSION_SECRET),
  AUTH_COOKIE_PREFIX: emptyToUndefined(process.env.AUTH_COOKIE_PREFIX),
  SEEKER_ALLOWED_EMAILS: emptyToUndefined(process.env.SEEKER_ALLOWED_EMAILS),
})

// Surface a sub-ceiling timeout at module load — silent misconfig would make the
// proxy abort before the route's 90s frame, mislabeling every turn (KTD4). The
// value is still honored (lowering is a documented escape hatch); this is a warning.
{
  const parsed = Number(env.SEEKER_TIMEOUT_MS)
  if (
    env.SEEKER_TIMEOUT_MS !== undefined &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed < ROUTE_CEILING_MS
  ) {
    console.warn(
      `[seeker-chat] event=timeout_below_route_ceiling configured_ms=${parsed} ceiling_ms=${ROUTE_CEILING_MS}`,
    )
  }
}

/** Whether the chat app should route messages to Seeker (vs the local stub). */
export function isSeekerChatEnabled(): boolean {
  return env.SEEKER_CHAT_ENABLED === "true"
}

/**
 * Whether an email is on the seeker dogfood allowlist. SEEKER_ALLOWED_EMAILS
 * is a CSV of emails; both the entries and the input are normalized (trim,
 * lowercase) so casing or stray whitespace in the Railway value can't silently
 * deny a dogfooder. Fail-closed: unset or empty admits no one, and a
 * whitespace-only input never matches (entries are filtered non-empty).
 */
export function isSeekerEmailAllowed(email: string): boolean {
  if (!env.SEEKER_ALLOWED_EMAILS) return false
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  return env.SEEKER_ALLOWED_EMAILS.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized)
}

/**
 * The outbound proxy→Mastra timeout in ms. Tolerant: a non-numeric, zero, or
 * negative `SEEKER_TIMEOUT_MS` falls back to the documented default rather than
 * crashing boot or making `AbortSignal.timeout` fire instantly (every turn
 * would time out). Must stay > the route's 90s ceiling (see plan KTD4).
 */
export function seekerTimeoutMs(): number {
  const parsed = Number(env.SEEKER_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

/**
 * Whether CHAT_SESSION_SECRET is a real signing secret (not absent, not the
 * shipped placeholder, and at least the 32-char minimum). The fail-closed R11
 * guarantee rides on this concrete check — a present-but-guessable secret must
 * count as unconfigured, not merely "set".
 */
export function isRealSessionSecret(value: string | undefined): boolean {
  return (
    value !== undefined &&
    value !== CHAT_SESSION_SECRET_PLACEHOLDER &&
    value.length >= MIN_SESSION_SECRET_LENGTH
  )
}

/**
 * Whether CHAT_BASE_URL is a usable absolute http(s) origin. A scheme-less value
 * (e.g. "chat.jesusfilm.org") is NOT valid: it can't build a redirect_uri and
 * would throw in new URL(). Validated here (runtime) rather than via a zod
 * .url() refinement, which would crash boot for a set-but-malformed value and
 * break the opt-in-env-boots-clean guarantee.
 */
export function isValidChatBaseUrl(value: string | undefined): boolean {
  if (value === undefined) return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Whether chat's OAuth sign-in path is fully configured. True only when the
 * issuer, chat client id, chat base URL, and a REAL signing secret are all
 * present (KTD6). When false the sidebar hides the "Sign in" affordance and the
 * login route refuses to start a flow, so chat never dead-ends in a
 * redirect_uri mismatch. The out-of-codebase client registration lands before
 * these are set per environment.
 */
export function chatAuthConfigured(): boolean {
  return (
    env.AUTH_ISSUER_URL !== undefined &&
    env.AUTH_CHAT_CLIENT_ID !== undefined &&
    isValidChatBaseUrl(env.CHAT_BASE_URL) &&
    isRealSessionSecret(env.CHAT_SESSION_SECRET)
  )
}

/** The cookie-name prefix for chat's auth cookies (AUTH_COOKIE_PREFIX or the default). */
export function chatAuthCookiePrefix(): string {
  return env.AUTH_COOKIE_PREFIX?.trim() || DEFAULT_CHAT_AUTH_COOKIE_PREFIX
}
