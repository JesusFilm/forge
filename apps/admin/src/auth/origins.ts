import { env } from "@/config/env"

export const PRODUCTION_AUTH_BASE_URL = "https://auth.jesusfilm.org"
export const LOCAL_AUTH_BASE_URL = "http://localhost:3003"

export const PRODUCTION_AUTH_TRUSTED_ORIGINS = [
  "https://admin.jesusfilm.org",
  "https://web.jesusfilm.org",
  "https://manager.jesusfilm.org",
] as const

function parseOrigins(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : []
}

export function getAuthBaseURL(): string {
  return env.BETTER_AUTH_URL ?? productionDefault(PRODUCTION_AUTH_BASE_URL)
}

export function getAuthTrustedOrigins(): string[] {
  const configured = parseOrigins(env.AUTH_TRUSTED_ORIGINS)
  if (configured.length > 0) {
    return configured
  }

  return env.NODE_ENV === "production"
    ? [...PRODUCTION_AUTH_TRUSTED_ORIGINS]
    : []
}

export function isTrustedAuthOrigin(origin: string | null): boolean {
  if (!origin) return false

  return new Set([getAuthBaseURL(), ...getAuthTrustedOrigins()]).has(origin)
}

export function getDefaultPostLoginURL(): string {
  const [primaryAppOrigin] = getAuthTrustedOrigins()
  return `${primaryAppOrigin ?? getAuthBaseURL()}/dashboard`
}

export function getDefaultLoginDestinationName(): string {
  return "Forge administration panel"
}

export function resolveAuthCallbackURL(
  callbackURL: string | undefined,
  fallbackURL = getDefaultPostLoginURL(),
): string {
  if (!callbackURL) {
    return fallbackURL
  }

  try {
    const parsed = new URL(callbackURL, fallbackURL)
    return isTrustedAuthOrigin(parsed.origin) ? parsed.toString() : fallbackURL
  } catch {
    return fallbackURL
  }
}

export function getLoginDestinationName(callbackURL: string): string {
  try {
    const url = new URL(callbackURL)
    if (url.hostname === "admin.jesusfilm.org") {
      return "Forge administration panel"
    }
    if (url.hostname === "web.jesusfilm.org") {
      return "JesusFilm web"
    }
    if (url.hostname === "manager.jesusfilm.org") {
      return "VideoForge Manager"
    }
    return url.hostname
  } catch {
    return getDefaultLoginDestinationName()
  }
}

function productionDefault(productionValue: string): string {
  return env.NODE_ENV === "production" ? productionValue : LOCAL_AUTH_BASE_URL
}
