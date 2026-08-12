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
import { router } from "expo-router"

import { ProfileScreen } from "../src/components/profile/ProfileScreen"
import {
  HANDOFF_MAX_WAIT_MS,
  remainingConfirmationDelayMs,
  shouldHandOffToHome,
} from "../src/lib/auth/signInHandoff"
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
  flushOwnedShelfOnSignOut,
  hydrateContinueWatchingFromAccount,
  purgeAccountProgressCache,
  submitContinueWatchingToAccount,
  syncContinueWatchingWithAccount,
} from "../src/lib/watchEvents/watchProgressSync"
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

  // Set when the device grant completes in THIS mount, and cleared by the
  // handoff. It is what separates "the viewer just approved on their phone"
  // from the two other routes to a signed-in session — a stored session
  // adopted at launch, and a deliberate Profile visit while signed in. Sending
  // either of those to Home would make this screen unreachable.
  const freshGrantAtRef = useRef<number | null>(null)
  const handedOffRef = useRef(false)
  /** Resolver the aftermath calls when it settles, so the handoff can wait on
   *  the merge without the two effects sharing state through a re-render. */
  const aftermathSettledRef = useRef<(() => void) | null>(null)

  /** Back to Home after a completed sign-in. `back()` rather than a replace:
   *  Home PUSHED this route, so popping restores its scroll position, focus
   *  memory and loaded model instead of remounting the whole screen. */
  const handOffToHome = useCallback(() => {
    if (handedOffRef.current) return
    handedOffRef.current = true
    try {
      if (router.canGoBack()) router.back()
      else router.replace("/")
    } catch {
      // Navigation must never surface as a failed sign-in — the viewer is
      // signed in either way, they are just still looking at this screen.
    }
  }, [])

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
        //
        // AWAITED, unlike the promotion's own fire-and-forget style, because
        // the handoff below waits on it: Home reloads Continue Watching when
        // it gains focus, so arriving before the account rows land would show
        // the pre-merge shelf until the next visit. `HANDOFF_MAX_WAIT_MS`
        // bounds the wait, and every call here already swallows its failures.
        if (outcome.status === "already_merged") {
          await syncContinueWatchingWithAccount()
        } else if (outcome.status !== "failed") {
          await hydrateContinueWatchingFromAccount()
        }
      } catch {
        // Sign-in has already succeeded. Nothing in the aftermath is allowed
        // to unwind it or surface as a failure to the viewer.
      } finally {
        // `finally`, so a thrown identity lookup or a declined promotion still
        // hands off — a viewer who is signed in must never be stranded on the
        // code screen by the aftermath's best-effort work.
        aftermathSettledRef.current?.()
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
      // Stamped here, at the ONE transition that means "the viewer just
      // approved on their phone" — the handoff reads it to tell that apart
      // from a stored session or a deliberate Profile visit.
      freshGrantAtRef.current ??= Date.now()
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

  // Hand the viewer back to Home once a FRESH sign-in has landed.
  //
  // Ordering, and why it is worth the machinery: wait for the aftermath (so
  // Home paints an already-merged shelf rather than the pre-merge one), but
  // never longer than HANDOFF_MAX_WAIT_MS (so a dead network cannot strand a
  // signed-in viewer on the code screen), then hold the confirmed state for
  // its floor so the approval visibly registers before the screen changes.
  useEffect(() => {
    const grantedAtMs = freshGrantAtRef.current
    if (
      !shouldHandOffToHome({
        grantCompleted: grantedAtMs != null,
        signedIn: session?.kind === "signed_in",
        alreadyHandedOff: handedOffRef.current,
      })
    ) {
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const settled = new Promise<void>((resolve) => {
      aftermathSettledRef.current = resolve
    })

    void (async () => {
      await Promise.race([
        settled,
        new Promise<void>((resolve) =>
          setTimeout(resolve, HANDOFF_MAX_WAIT_MS),
        ),
      ])
      if (cancelled) return
      const delay = remainingConfirmationDelayMs(
        grantedAtMs ?? Date.now(),
        Date.now(),
      )
      timer = setTimeout(() => {
        if (!cancelled) handOffToHome()
      }, delay)
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      // Restored, not just released: the setup re-creates the promise on the
      // next run, and a stale resolver left here would settle THAT promise's
      // predecessor and never the new one (StrictMode remounts this effect).
      aftermathSettledRef.current = null
    }
  }, [session, handOffToHome])

  const handleSignOut = useCallback(() => {
    void (async () => {
      try {
        // Final flush BEFORE the token is revoked: sign-out wipes the local
        // shelf (privacy on a shared TV), so anything not yet in the account
        // would be lost. Gated on the ownership marker AND time-bounded
        // inside `flushOwnedShelfOnSignOut`, which never throws — an unowned
        // or someone-else's shelf is skipped rather than uploaded here.
        await flushOwnedShelfOnSignOut(identity?.userId)
        await signOut()
        // The account marker is released so the NEXT viewer starts clean
        // rather than being treated as an already-merged returning user.
        await releaseLocalUserOnSignOut()
        // Third copy of the departing viewer's history — see the purge's own
        // comment. Never throws, so it cannot unwind a completed sign-out.
        await purgeAccountProgressCache()
        reportDeviceGrantSignedOut("revoked")
      } catch {
        reportDeviceGrantSignedOut("local_only")
      } finally {
        setIdentity(null)
        setSession({ kind: "signed_out" })
      }
    })()
    // `identity?.userId` is a real dependency, not ceremony: it is the account
    // the flush is authorized against, and an empty array would pin this
    // callback to the first render's `null` — refusing every flush.
  }, [identity?.userId])

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
