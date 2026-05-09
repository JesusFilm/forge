export const MANAGER_SESSION_COOKIE = "manager-session"

function readCookie(cookieHeader: string, name: string): string | null {
  const encodedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${encodedName}=([^;]+)`),
  )
  try {
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

export function readManagerSessionToken(cookieHeader: string): string | null {
  return readCookie(cookieHeader, MANAGER_SESSION_COOKIE)
}
