"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// The real Watch account, as the server's own session route reports it.
//
// Identity is whatever `/watch/api/auth/session` says about the HttpOnly
// session cookie, and only that: no stored flag, URL parameter or browser
// event can set it. Events (focus, visibility) only cause a fresh server
// read. `authenticated` alone decides signed in; `accountGateEnabled` governs
// the download rollout, not whether a visitor has an account. Any answer that
// is not a well-formed session locks (`unavailable`), because a failure to
// confirm identity must never read as signed in.
//
// Any real signed-in account qualifies: Partner is an audience choice, not an
// entitlement (KTD7). Mount this only where account tools are wanted, so no
// session request is made for visitors who never open them.

export type WatchAccountUser = {
  id?: string
  email?: string
  name?: string
  image?: string
}

export type WatchAccountSession =
  | { status: "checking" }
  | { status: "unavailable" }
  | { status: "signed-out"; loginUrl?: string }
  | { status: "signed-in"; user?: WatchAccountUser }

const USER_FIELDS = ["id", "email", "name", "image"] as const

/** Set by the OAuth callback when a sign-in attempt does not complete. */
const AUTH_FAILURE_PARAMS = ["auth", "reason"] as const

/** The current page as a safe-to-return-to path, without sign-in failure markers. */
export function watchAccountReturnTo(): string {
  const url = new URL(window.location.href)
  for (const param of AUTH_FAILURE_PARAMS) url.searchParams.delete(param)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The hosted login/logout URL, pointed back at the page the visitor is on now.
 * The server's own `loginUrl` is kept as the base when it sent one; its return
 * target is replaced because it was fixed when the session was read.
 */
export function watchAccountAuthUrl(
  kind: "login" | "logout",
  serverLoginUrl?: string,
): string {
  const url = new URL(
    kind === "login" && serverLoginUrl
      ? serverLoginUrl
      : `/watch/api/auth/${kind}`,
    window.location.origin,
  )
  url.searchParams.set("returnTo", watchAccountReturnTo())
  return url.toString()
}

export async function readWatchAccountSession(
  signal?: AbortSignal,
): Promise<WatchAccountSession> {
  const url = new URL("/watch/api/auth/session", window.location.origin)
  url.searchParams.set("callbackURL", watchAccountReturnTo())

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    })
    if (!response.ok) return { status: "unavailable" }
    return parseSession(await response.json())
  } catch {
    return { status: "unavailable" }
  }
}

function parseSession(value: unknown): WatchAccountSession {
  if (!isRecord(value)) return { status: "unavailable" }
  if (typeof value.accountGateEnabled !== "boolean") {
    return { status: "unavailable" }
  }
  if (typeof value.authenticated !== "boolean") return { status: "unavailable" }
  if (value.user !== undefined && !isUser(value.user)) {
    return { status: "unavailable" }
  }

  if (value.authenticated) return { status: "signed-in", user: value.user }
  if (value.user !== undefined) return { status: "unavailable" }
  return {
    status: "signed-out",
    ...(typeof value.loginUrl === "string" ? { loginUrl: value.loginUrl } : {}),
  }
}

function isUser(value: unknown): value is WatchAccountUser {
  return (
    isRecord(value) &&
    USER_FIELDS.every(
      (field) => value[field] === undefined || typeof value[field] === "string",
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

export function useWatchAccountSession(): {
  session: WatchAccountSession
  /** Locks, then asks the server again. */
  retry: () => void
} {
  const [session, setSession] = useState<WatchAccountSession>({
    status: "checking",
  })
  // Lazily minted per read: the newest read wins, an older one is aborted and
  // its answer discarded, so a slow signed-in response can never overwrite a
  // later signed-out one.
  const inFlight = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    void readWatchAccountSession(controller.signal).then((next) => {
      if (!controller.signal.aborted) setSession(next)
    })
  }, [])

  useEffect(() => {
    refresh()
    // Expiry and sign-out elsewhere surface when the visitor comes back. The
    // events only trigger a read; they never decide the state themselves.
    const revalidate = () => {
      if (document.visibilityState === "visible") refresh()
    }
    window.addEventListener("focus", revalidate)
    document.addEventListener("visibilitychange", revalidate)
    return () => {
      window.removeEventListener("focus", revalidate)
      document.removeEventListener("visibilitychange", revalidate)
      inFlight.current?.abort()
      inFlight.current = null
    }
  }, [refresh])

  const retry = useCallback(() => {
    setSession({ status: "checking" })
    refresh()
  }, [refresh])

  return { session, retry }
}
