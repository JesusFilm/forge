/**
 * Sign-in actions: the hosted-page flow is the only mobile login (feat-349).
 * The app renders no credential UI — the browser sheet and the session
 * handoff live in the Better Auth expo client; every DECISION lives in
 * authFlows.ts / authSession.ts / accountDeletion.ts, all pure-tested.
 *
 * Each action resolves to a typed outcome the caller renders: success, a
 * quiet cancel, or a retryable error. R15's new-account signal is NOT an
 * outcome variant — a blocking interstitial was rejected — it raises the
 * Profile notice in newAccountNotice.ts instead.
 */

import {
  outcomeFromDeleteResult,
  type DeleteAccountOutcome,
} from "./accountDeletion"
import { classifySignInFailure, type SignInFailureKind } from "./authFlows"
import {
  authFetchOptions,
  getAuthClient,
  getAuthSession,
  type AuthUser,
} from "./authSession"
import { reportDatadogAction } from "./datadog"
import {
  noteAccountCreated,
  wasAccountCreatedThisSignIn,
} from "./newAccountNotice"

export type SignInOutcome =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "error" }

const OUTCOME_BY_FAILURE: Record<SignInFailureKind, SignInOutcome> = {
  retryable: { status: "error" },
}

/** A thrown browser open is never a user cancel — a cancel settles
 *  session-less (KTD6) — so the classifier always maps it retryable. */
function toSignInOutcome(error: unknown): SignInOutcome {
  return OUTCOME_BY_FAILURE[classifySignInFailure(error)]
}

/**
 * Hosted-page sign-in (F2): the jfp self-RP flow. The Expo client opens
 * the browser sheet itself and captures the session cookie from the
 * forgemobile:// callback; afterwards an outcome-reporting session read
 * (KTD6) determines who — if anyone — signed in.
 */
async function runHostedSignIn(): Promise<SignInOutcome> {
  const store = getAuthSession()
  const before = store.getSnapshot()
  try {
    const result = await getAuthClient().signIn.oauth2({
      providerId: "jfp",
      callbackURL: "/",
      // Bounds only the pre-browser authorize-URL POST: better-fetch clears
      // its abort timer before onSuccess, where the expo plugin opens the
      // sheet (dists verified 2026-08-11, expo 1.6.2 + better-fetch 1.1.21).
      ...authFetchOptions(),
    })
    if (result.error) return { status: "error" }
  } catch (error) {
    return toSignInOutcome(error)
  }
  let user: AuthUser | null
  try {
    user = await store.readSession()
  } catch {
    // The cookie may already be stored; one retry before giving up (KTD6).
    try {
      user = await store.readSession()
    } catch {
      return { status: "error" }
    }
  }
  if (user == null) {
    // Sheet dismissed OR a cookie-less callback failure — the installed
    // expo client returns identically for both; quiet cancel by design.
    return { status: "cancelled" }
  }
  // A cancel is an UNCHANGED session, not only an absent one: prompt=login
  // mints a NEW sessionCreatedAt on every real sign-in, so the pre-flight
  // stamp surviving the read-back means no sign-in happened (deletion re-auth).
  if (
    before.status === "signedIn" &&
    user.id === before.user.id &&
    user.sessionCreatedAt === before.user.sessionCreatedAt
  ) {
    return { status: "cancelled" }
  }
  try {
    // R15 on the hosted path: both stamps are server clocks (KTD3).
    if (wasAccountCreatedThisSignIn(user.createdAt, user.sessionCreatedAt)) {
      noteAccountCreated(user.id)
    }
  } catch {
    // Total-catch: a throwing notice subscriber must not reject the shared
    // single-flight promise the UI awaits without .catch — the sign-in itself
    // succeeded (async-single-flight-slot-release-hazards.md).
  }
  reportDatadogAction("sign_in_completed", {})
  return { status: "success" }
}

let hostedSignInFlight: Promise<SignInOutcome> | null = null

/**
 * Single-flight (KTD4): iOS rejects a second concurrent auth session, so a
 * call while one is in flight JOINS it. Caller-side identity-checked release
 * per docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md.
 */
export function signInWithHostedPage(): Promise<SignInOutcome> {
  if (hostedSignInFlight) return hostedSignInFlight
  const flight = runHostedSignIn()
  hostedSignInFlight = flight
  const release = () => {
    if (hostedSignInFlight === flight) hostedSignInFlight = null
  }
  void flight.then(release, release)
  return flight
}

/** Sign out: revoke at auth then clear local session (R4). The progress
 *  lifecycle (store/snapshot/queue reset) reacts to the session change. */
export async function signOut(): Promise<void> {
  await getAuthSession().signOut()
}

/**
 * Delete the account (U7): no verification email exists platform-wide, so
 * a stale session asks for SSO re-auth first (the fresh-session check);
 * success clears local state via the normal signed-out transition.
 */
export async function deleteAccount(): Promise<DeleteAccountOutcome> {
  let outcome: DeleteAccountOutcome
  try {
    outcome = outcomeFromDeleteResult(await getAuthClient().deleteUser())
  } catch {
    return { status: "error" }
  }
  if (outcome.status === "deleted") {
    // The account is gone; signOut's remote leg fails harmlessly and the
    // local clear + progress lifecycle run off the signed-out transition.
    await getAuthSession().signOut()
  }
  return outcome
}
