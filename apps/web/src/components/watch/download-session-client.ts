"use client"

export type DownloadSessionStatus =
  | {
      ok: true
      accountGateEnabled: boolean
      authenticated: boolean
      loginUrl?: string
    }
  | { ok: false; reason: "session-unavailable" }

export const DOWNLOAD_RETURN_INTENT_PARAM = "download"

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
      accountGateEnabled?: unknown
      authenticated?: unknown
      loginUrl?: unknown
    }
    return {
      ok: true,
      accountGateEnabled: data.accountGateEnabled === true,
      authenticated: data.authenticated === true,
      ...(typeof data.loginUrl === "string" ? { loginUrl: data.loginUrl } : {}),
    }
  } catch {
    return { ok: false, reason: "session-unavailable" }
  }
}

export function withDownloadReturnIntent(loginUrl: string | undefined): string {
  if (!loginUrl) return ""
  if (typeof window === "undefined") return loginUrl

  try {
    const url = new URL(loginUrl, window.location.origin)
    const returnTo = new URL(
      url.searchParams.get("returnTo") || window.location.href,
      window.location.origin,
    )
    returnTo.searchParams.set(DOWNLOAD_RETURN_INTENT_PARAM, "1")
    url.searchParams.set("returnTo", returnTo.toString())
    url.searchParams.set("prompt", "login")
    return url.toString()
  } catch {
    return loginUrl
  }
}

export function redirectToAuth(
  loginUrl: string | undefined,
  options: { reopenDownload?: boolean } = {},
): void {
  if (!loginUrl) return
  window.location.assign(
    options.reopenDownload ? withDownloadReturnIntent(loginUrl) : loginUrl,
  )
}
