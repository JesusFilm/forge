// Composition root for the profile / sign-in route (feat-322 PR4).
//
// Everything decided here is a WIRING decision — apps/tv has no render harness,
// so every rule worth testing lives in a React-free module and this file only
// joins them up:
//
//   useDeviceGrant  — polling machine + transport
//   session         — token storage, single-flight refresh, sign out
//   profile         — identity (userinfo first)
//   anonymousMerge  — anonymous → account promotion, account isolation
//   telemetry       — sanitized, PII-free signals
//
// Kept deliberately thin and re-readable for exactly that reason.

import { useCallback, useEffect, useState } from "react"

import { ProfileScreen } from "../src/components/profile/ProfileScreen"
import {
  formatUserCode,
  type DeviceAuthPhase,
} from "../src/lib/auth/deviceAuthFlow"
import { isProfileSurfaceEnabled } from "../src/lib/auth/profileFlag"
import { useDeviceGrant } from "../src/lib/auth/useDeviceGrant"
import { resolveTvIdentity } from "../src/lib/auth/profile"
import { promoteAnonymousStateToAccount } from "../src/lib/auth/anonymousMerge"
import {
  reportAnonymousMergeOutcome,
  reportDeviceGrantApproved,
  reportDeviceGrantDenied,
  reportDeviceGrantError,
  reportDeviceGrantExpired,
  reportDeviceGrantSignedOut,
} from "../src/lib/auth/deviceGrantTelemetry"
import {
  getValidAccessToken,
  hydrateSession,
  signOut,
  type SessionState,
} from "../src/lib/auth/session"
import { releaseLocalUserOnSignOut } from "../src/lib/auth/anonymousMerge"
import { submitQueuedWatchEvent } from "../src/lib/watchEvents/recordWatchEvent"
import { getDeviceGrantConfig } from "../src/lib/auth/deviceGrantClient"

type Identity = { name: string; email: string; userId: string }

export default function ProfileRoute() {
  const enabled = isProfileSurfaceEnabled()
  const [session, setSession] = useState<SessionState | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)

  // A stored session must be adopted before the grant starts, or a TV that is
  // already signed in would show a sign-in code on every launch.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await hydrateSession()
        if (!cancelled) setSession(next)
      } catch {
        if (!cancelled) setSession({ kind: "signed_out" })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signedOut = session?.kind === "signed_out"
  const grant = useDeviceGrant(enabled && signedOut)

  // Start the flow once we know the viewer is actually signed out.
  const { start, state: grantState } = grant
  useEffect(() => {
    if (enabled && signedOut && grantState.phase.kind === "idle") start()
  }, [enabled, signedOut, grantState.phase.kind, start])

  // Sign-in aftermath: identity, then the anonymous → account promotion.
  useEffect(() => {
    if (session?.kind !== "signed_in") return
    let cancelled = false

    void (async () => {
      try {
        const accessToken = await getValidAccessToken()
        if (accessToken == null || cancelled) return

        const result = await resolveTvIdentity({
          authBaseUrl: getDeviceGrantConfig().authBaseUrl,
          accessToken,
        })
        if (cancelled || result.kind !== "ok") return

        const { subject, name, email } = result.identity
        setIdentity({
          userId: subject,
          name: name ?? email ?? "Signed in",
          email: email ?? "",
        })

        // Idempotent by construction, and the isolation boundary: buckets
        // belonging to a DIFFERENT account are wiped rather than inherited by
        // whoever signs in next on a shared TV.
        const outcome = await promoteAnonymousStateToAccount({
          userId: subject,
          // Continue Watching is device-local today — admin exposes no
          // promotion mutation for it, only `recordWatchEvent`. Claiming it
          // for this account locally is what stops the next family member
          // inheriting it; server-side sync is follow-up work, not something
          // to fake a success for here.
          submitProgress: async () => true,
          submitWatchEvent: submitQueuedWatchEvent,
        })
        reportAnonymousMergeOutcome({ status: outcome.status })
      } catch {
        // Sign-in has already succeeded. Nothing in the aftermath is allowed
        // to unwind it or surface as a failure to the viewer.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [session])

  // Adopt a freshly granted session and report the terminal grant outcomes.
  const phaseKind = grantState.phase.kind
  useEffect(() => {
    if (phaseKind === "granted") {
      reportDeviceGrantApproved(0)
      void hydrateSession().then(setSession, () => undefined)
      return
    }
    if (phaseKind === "denied") reportDeviceGrantDenied()
    if (phaseKind === "error") {
      const code =
        grantState.phase.kind === "error" ? grantState.phase.code : "unknown"
      if (code === "expired_token") reportDeviceGrantExpired()
      else reportDeviceGrantError(code)
    }
  }, [phaseKind, grantState.phase])

  const handleSignOut = useCallback(() => {
    void (async () => {
      try {
        await signOut()
        // The account marker is released so the NEXT viewer starts clean
        // rather than being treated as an already-merged returning user.
        await releaseLocalUserOnSignOut()
        reportDeviceGrantSignedOut("revoked")
      } catch {
        reportDeviceGrantSignedOut("local_only")
      } finally {
        setIdentity(null)
        setSession({ kind: "signed_out" })
      }
    })()
  }, [])

  if (!enabled) return null

  return (
    <ProfileScreen
      phase={toAuthPhase(grantState.phase, session, identity)}
      onRequestNewCode={start}
      onSignOut={handleSignOut}
    />
  )
}

/**
 * The machine's phase plus the session, projected onto what the screen renders.
 *
 * Signed-in wins over any grant phase: once a session exists the code on screen
 * is stale by definition.
 */
function toAuthPhase(
  phase: ReturnType<typeof useDeviceGrant>["state"]["phase"],
  session: SessionState | null,
  identity: Identity | null,
): DeviceAuthPhase {
  if (session?.kind === "signed_in") {
    return {
      kind: "signedIn",
      profile: {
        name: identity?.name ?? "Signed in",
        email: identity?.email ?? "",
      },
    }
  }
  if (phase.kind === "waiting") {
    return {
      kind: "pending",
      session: {
        userCode: formatUserCode(phase.userCode),
        verificationUrl: phase.verificationUriComplete,
        expiresAtMs: phase.expiresAtMs,
      },
    }
  }
  return { kind: "signedOut" }
}
