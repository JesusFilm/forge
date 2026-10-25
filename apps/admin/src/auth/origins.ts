import { env } from "@/config/env"

export const PRODUCTION_ADMIN_BASE_URL = "https://admin.jesusfilm.org"

export function getAuthBaseURL(): string {
  return new URL(env.AUTH_ISSUER_URL).origin
}

export function getAdminBaseURL(): string {
  return env.ADMIN_BASE_URL ?? productionDefault(PRODUCTION_ADMIN_BASE_URL)
}

export function isTrustedReturnToOrigin(origin: string | null): boolean {
  if (!origin) return false

  return new URL(getAdminBaseURL()).origin === origin
}

export function getDefaultPostLoginURL(): string {
  return `${new URL(getAdminBaseURL()).origin}/dashboard`
}

export function getDefaultLoginDestinationName(): string {
  return "Forge administration panel"
}

export function resolveAdminReturnToURL(
  returnTo: string | undefined,
  fallbackURL = getDefaultPostLoginURL(),
): string {
  if (!returnTo) {
    return fallbackURL
  }

  try {
    const parsed = new URL(returnTo, fallbackURL)
    return isTrustedReturnToOrigin(parsed.origin)
      ? parsed.toString()
      : fallbackURL
  } catch {
    return fallbackURL
  }
}

export function getLoginDestinationName(returnTo: string): string {
  try {
    const url = new URL(returnTo)
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
  return env.NODE_ENV === "production"
    ? productionValue
    : "http://localhost:3003"
}
