"use client"

export type DownloadSessionStatus = {
  authenticated: boolean
  gateEnabled: boolean
  loginUrl?: string
}

export async function checkDownloadSession(): Promise<DownloadSessionStatus> {
  const url = new URL("/watch/api/auth/session", window.location.origin)
  url.searchParams.set("callbackURL", window.location.href)

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "include",
    })
    if (!response.ok) return { authenticated: false, gateEnabled: true }

    const data = (await response.json()) as {
      authenticated?: unknown
      gateEnabled?: unknown
      loginUrl?: unknown
    }
    return {
      authenticated: data.authenticated === true,
      gateEnabled: data.gateEnabled === true,
      ...(typeof data.loginUrl === "string" ? { loginUrl: data.loginUrl } : {}),
    }
  } catch {
    return { authenticated: false, gateEnabled: true }
  }
}

export function redirectToAuth(loginUrl: string | undefined): void {
  if (!loginUrl) return
  window.location.assign(loginUrl)
}
