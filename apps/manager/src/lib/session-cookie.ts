export const MANAGER_SESSION_COOKIE = "manager-session"
export const LEGACY_STRAPI_SESSION_COOKIE = "strapi-jwt"

function readCookie(cookieHeader: string, name: string): string | null {
  const encodedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${encodedName}=([^;]+)`),
  )
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function readManagerSessionToken(cookieHeader: string): string | null {
  return (
    readCookie(cookieHeader, MANAGER_SESSION_COOKIE) ??
    readCookie(cookieHeader, LEGACY_STRAPI_SESSION_COOKIE)
  )
}
