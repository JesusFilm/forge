import { env, isValidChatBaseUrl } from "@/config/env"

/**
 * Chat's own-origin resolution + post-login return-target validation (R10).
 * Ported from the relevant slice of apps/admin/src/auth/origins.ts — chat drops
 * admin's multi-host destination-name map (not needed). Any return target that
 * is cross-origin or unparseable falls back to chat's home, on BOTH the success
 * and failure paths.
 */
const PRODUCTION_CHAT_BASE_URL = "https://chat.jesusfilm.org"
const LOCAL_CHAT_BASE_URL = "http://localhost:3200"

/**
 * Chat's configured public base URL. Falls through to the environment default
 * when CHAT_BASE_URL is unset OR malformed (scheme-less), so getChatHomeURL /
 * isTrustedReturnToOrigin never throw — a bad value fails closed to anonymous
 * rather than 500-ing every auth route.
 */
export function getChatBaseURL(): string {
  if (isValidChatBaseUrl(env.CHAT_BASE_URL)) return env.CHAT_BASE_URL as string
  return env.NODE_ENV === "production"
    ? PRODUCTION_CHAT_BASE_URL
    : LOCAL_CHAT_BASE_URL
}

/** Chat's home URL — the fallback for any untrusted/unparseable return target. */
export function getChatHomeURL(): string {
  return `${new URL(getChatBaseURL()).origin}/`
}

/** Whether an origin is chat's own origin (the only trusted return-to origin). */
export function isTrustedReturnToOrigin(origin: string | null): boolean {
  if (!origin) return false
  return new URL(getChatBaseURL()).origin === origin
}

/**
 * Validate a post-login `return_to` against chat's own origin, falling back to
 * chat home for a cross-origin, unparseable, or absent target (R10).
 */
export function resolveChatReturnToURL(
  returnTo: string | undefined,
  fallbackURL = getChatHomeURL(),
): string {
  if (!returnTo) return fallbackURL

  try {
    const parsed = new URL(returnTo, fallbackURL)
    return isTrustedReturnToOrigin(parsed.origin)
      ? parsed.toString()
      : fallbackURL
  } catch {
    return fallbackURL
  }
}
