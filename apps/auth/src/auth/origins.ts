import { env, getAuthBaseUrl } from "@/config/env"

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

export function getAuthTrustedOrigins(): string[] {
  const configured = parseOrigins(env.AUTH_TRUSTED_ORIGINS)
  if (configured.length > 0) {
    return configured
  }

  return process.env.NODE_ENV === "production"
    ? [...PRODUCTION_AUTH_TRUSTED_ORIGINS]
    : ["http://localhost:3003"]
}

export function isTrustedAuthOrigin(origin: string | null): boolean {
  if (!origin) return false

  return new Set([getAuthBaseUrl(), ...getAuthTrustedOrigins()]).has(origin)
}

export function getDefaultPostLoginUrl(): string {
  const [primaryAppOrigin] = getAuthTrustedOrigins()
  return `${primaryAppOrigin ?? getAuthBaseUrl()}/dashboard`
}

export function resolveAuthCallbackUrl(
  callbackUrl: string | undefined,
  fallbackUrl = getDefaultPostLoginUrl(),
): string {
  if (!callbackUrl) {
    return fallbackUrl
  }

  try {
    const parsed = new URL(callbackUrl, fallbackUrl)
    return isTrustedAuthOrigin(parsed.origin) ? parsed.toString() : fallbackUrl
  } catch {
    return fallbackUrl
  }
}
