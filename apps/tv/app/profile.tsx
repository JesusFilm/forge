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

import { useCallback, useEffect, useRef, useState } from "react"

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
import {
  hydrateContinueWatchingFromAccount,
  submitContinueWatchingToAccount,
  syncContinueWatchingWithAccount,
} from "../src/lib/watchEvents/watchProgressSync"
import { loadContinueWatching } from "../src/lib/watchEvents/continueWatching"
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
        if (accessToken == null) return

        const result = await resolveTvIdentity({
          authBaseUrl: getDeviceGrantConfig().authBaseUrl,
          accessToken,
        })
        if (result.kind !== "ok") return

        const { subject, name, email } = result.identity
        // `cancelled` gates the STATE UPDATE only. It must not gate the
        // promotion below: the cleanup fires whenever the viewer leaves the
        // screen, and `resolveTvIdentity` is a network round trip with a 6s
        // budget, so a Back press right after approval would otherwise leave a
        // signed-in viewer's buckets marked UNOWNED. That is the exact state
        // `decideMergeAction` reads as `promote`, so the next person to sign in
        // on the TV inherits them — see anonymousMerge.ts rule 1.
        if (!cancelled) {
          setIdentity({
            userId: subject,
            name: name ?? email ?? "Signed in",
            email: email ?? "",
          })
        }

        // Idempotent by construction, and the isolation boundary: buckets
        // belonging to a DIFFERENT account are wiped rather than inherited by
        // whoever signs in next on a shared TV.
        const outcome = await promoteAnonymousStateToAccount({
          userId: subject,
          // The real account submit (feat-322 U4.6): shelf entries land in
          // admin's `upsertMyWatchProgress` — the same rows mobile writes. A
          // false return maps onto the `failed` outcome, which leaves every
          // bucket untouched for the next sign-in to retry.
          submitProgress: (payload) =>
            submitContinueWatchingToAccount(payload.continueWatching),
          submitWatchEvent: submitQueuedWatchEvent,
        })
        reportAnonymousMergeOutcome({ status: outcome.status })

        // Cross-device pull. After a fresh promotion the account may hold
        // positions from other devices that are further along; on a repeat
        // visit (`already_merged`) also push positions recorded since the
        // last visit before pulling. `failed` skips — the network already
        // declined once, and promotion will retry the whole pass next time.
        if (outcome.status === "already_merged") {
          void syncContinueWatchingWithAccount()
        } else if (outcome.status !== "failed") {
          void hydrateContinueWatchingFromAccount()
        }
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
  //
  // `waitStartedAtRef` exists because `reportDeviceGrantApproved` is a DURATION
  // signal — "how long the QR was on screen", the activation metric the
  // device_grant.approved facet is sized on. Reporting a constant would publish
  // a facet whose every value is a lie, which is worse than not shipping it.
  const phaseKind = grantState.phase.kind
  const waitStartedAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (phaseKind === "waiting") {
      // `??=` so a re-render mid-wait (each poll tick) does not restart the
      // clock; `start()` clears it below when the code is replaced.
      waitStartedAtRef.current ??= Date.now()
      return
    }
    if (phaseKind === "granted") {
      const startedAtMs = waitStartedAtRef.current
      waitStartedAtRef.current = null
      reportDeviceGrantApproved(
        startedAtMs != null ? (Date.now() - startedAtMs) / 1000 : 0,
      )
      void hydrateSession().then(setSession, () => undefined)
      return
    }
    waitStartedAtRef.current = null
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
        // Final flush BEFORE the token is revoked: sign-out wipes the local
        // shelf (privacy on a shared TV), so anything not yet in the account
        // would be lost. Best-effort — a failure must not block sign-out.
        try {
          await submitContinueWatchingToAccount(await loadContinueWatching())
        } catch {
          // The wipe below is still the right call; the account keeps
          // whatever the last successful sync delivered.
        }
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
