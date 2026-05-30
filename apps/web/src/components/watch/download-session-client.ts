"use client"

export type DownloadSessionStatus =
  | {
      ok: true
      authenticated: boolean
      gateEnabled: boolean
      loginUrl?: string
    }
  | { ok: false; reason: "session-unavailable" }

export async function checkDownloadSession(): Promise<DownloadSessionStatus> {
  const url = new URL("/watch/api/auth/session", window.location.origin)
  url.searchParams.set("callbackURL", window.location.href)

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "include",
    })
    if (!response.ok) return { ok: false, reason: "session-unavailable" }

    const data = (await response.json()) as {
      authenticated?: unknown
      gateEnabled?: unknown
      loginUrl?: unknown
    }
    return {
      ok: true,
      authenticated: data.authenticated === true,
      gateEnabled: data.gateEnabled === true,
      ...(typeof data.loginUrl === "string" ? { loginUrl: data.loginUrl } : {}),
    }
  } catch {
    return { ok: false, reason: "session-unavailable" }
  }
}

export function redirectToAuth(loginUrl: string | undefined): void {
  if (!loginUrl) return
  window.location.assign(loginUrl)
}
