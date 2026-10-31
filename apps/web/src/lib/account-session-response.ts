import { getRequestOrigin } from "@/auth/request-origin"
import type { AuthSessionResult } from "@/lib/auth-session"
import { resolveWatchCallbackURL } from "@/lib/watch-callback"
import type { WatchAccountSession } from "@/lib/watch-bootstrap-contract"

/**
 * The account-session body shared by `/watch/api/auth/session` and
 * `/watch/api/bootstrap`. Returns `null` when a signed-out viewer's
 * `callbackURL` is not an allowed Watch destination; each route maps that to
 * its own failure shape.
 */
export function buildAccountSessionBody({
  request,
  session,
  accountGateEnabled,
}: {
  request: Request
  session: AuthSessionResult
  accountGateEnabled: boolean
}): WatchAccountSession | null {
  if (session.authenticated) {
    return {
      accountGateEnabled,
      authenticated: true,
      user: session.user,
    }
  }

  const requestOrigin = getRequestOrigin(request)
  const callbackURL = resolveWatchCallbackURL(
    toAbsoluteWatchURL(
      new URL(request.url).searchParams.get("callbackURL"),
      requestOrigin,
    ),
    [requestOrigin],
  )
  if (!callbackURL) return null

  const loginUrl = new URL("/watch/api/auth/login", requestOrigin)
  loginUrl.searchParams.set("returnTo", callbackURL)

  return {
    accountGateEnabled,
    authenticated: false,
    loginUrl: loginUrl.toString(),
  }
}

function toAbsoluteWatchURL(value: string | null, origin: string) {
  if (!value) return value
  try {
    return new URL(value, origin).toString()
  } catch {
    return value
  }
}
