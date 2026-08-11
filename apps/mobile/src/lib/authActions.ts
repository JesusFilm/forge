/**
 * Sign-in flows (U6): native Apple/Google sheets plus the hosted-page
 * fallback. Native modules load lazily inside each flow (the root-layout
 * require pattern) so this module imports cleanly under jest; every
 * DECISION lives in authFlows.ts / authSession.ts, both pure-tested.
 *
 * Each flow resolves to a typed outcome the sheet renders: success, a quiet
 * cancel, or a retryable error. R15's new-account signal is NOT an outcome
 * variant — a blocking interstitial was rejected — it raises the Profile
 * notice in newAccountNotice.ts instead.
 */

import {
  outcomeFromDeleteResult,
  type DeleteAccountOutcome,
} from "./accountDeletion"
import { appleNameForIdToken, classifySignInFailure } from "./authFlows"
import {
  getAuthClient,
  getAuthSession,
  type AuthUser,
  type SignedInUserPayload,
} from "./authSession"
import { env } from "../env"
import { reportDatadogAction } from "./datadog"
import {
  classifyEmailAuthFailure,
  classifyLoginMethod,
  normalizeEmail,
  type EmailAuthFailure,
  type LoginMethod,
} from "./emailAuth"
import {
  noteAccountCreated,
  wasAccountCreatedThisSignIn,
  wasAccountJustCreated,
} from "./newAccountNotice"

export type SignInOutcome =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "error" }

/** The provider sheet succeeded; exchange the identity token with auth. */
async function completeSignIn(
  exchange: () => Promise<{
    data: { user: SignedInUserPayload } | null
    error?: { message?: string } | null
  }>,
): Promise<SignInOutcome> {
  let user: SignedInUserPayload | null = null
  try {
    const result = await exchange()
    if (result.error || !result.data?.user) return { status: "error" }
    user = result.data.user
  } catch {
    return { status: "error" }
  }
  const store = getAuthSession()
  store.applySignedIn({
    id: user.id,
    email: user.email ?? undefined,
    name: user.name ?? undefined,
  })
  // R15: an empty continue-watching row is expected on an account this
  // sign-in just created, so say so on Profile rather than let it read as
  // lost history.
  if (wasAccountJustCreated(user.createdAt, Date.now())) {
    noteAccountCreated(user.id)
  }
  // The adoption metric's first RUM action (Success Criteria).
  reportDatadogAction("sign_in_completed", {})
  return { status: "success" }
}

/* eslint-disable @typescript-eslint/no-require-imports */

/** A cancelled provider sheet is a user choice, not a failure to report. */
function toSignInOutcome(error: unknown): SignInOutcome {
  return classifySignInFailure("provider-sheet", error) === "cancelled"
    ? { status: "cancelled" }
    : { status: "error" }
}

export async function signInWithApple(): Promise<SignInOutcome> {
  const AppleAuthentication =
    require("expo-apple-authentication") as typeof import("expo-apple-authentication")
  let identityToken: string | null | undefined
  let authorizationCode: string | null | undefined
  let name: { firstName?: string; lastName?: string } | undefined
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
    identityToken = credential.identityToken
    authorizationCode = credential.authorizationCode
    name = appleNameForIdToken(credential.fullName)
  } catch (error) {
    return toSignInOutcome(error)
  }
  if (!identityToken) return { status: "error" }

  const outcome = await completeSignIn(() =>
    getAuthClient().signIn.social({
      provider: "apple",
      idToken: { token: identityToken, ...(name ? { user: { name } } : {}) },
    }),
  )

  // Best-effort: exchange the one-time code server-side so a revocable
  // Apple credential lands on the account row (deletion guidance). A
  // failure never blocks sign-in; deletion degrades to no Apple revoke.
  if (outcome.status === "success" && authorizationCode) {
    void getAuthClient()
      .$fetch("/mobile/apple/native-credential", {
        method: "POST",
        body: { authorizationCode },
      })
      .catch(() => {})
  }
  return outcome
}

export async function signInWithGoogle(): Promise<SignInOutcome> {
  const { GoogleSignin } =
    require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin")
  let idToken: string | null | undefined
  try {
    GoogleSignin.configure({
      // The web client id makes native idTokens carry the audience auth
      // already verifies (U1); the iOS client id configures the sheet.
      webClientId: env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    })
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    const response = await GoogleSignin.signIn()
    idToken = response.type === "success" ? response.data.idToken : undefined
    if (response.type === "cancelled") return { status: "cancelled" }
  } catch (error) {
    return toSignInOutcome(error)
  }
  if (!idToken) return { status: "error" }

  return completeSignIn(() =>
    getAuthClient().signIn.social({
      provider: "google",
      idToken: { token: idToken },
    }),
  )
}

/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Ask auth which method owns this email (the same check the web login page
 * makes) so someone whose account is a Google/Apple identity is pointed at
 * that button instead of creating a duplicate. Advisory only: a failed
 * lookup falls through to the password form, and the server still enforces.
 */
export async function lookupLoginMethod(email: string): Promise<LoginMethod> {
  try {
    const result = await getAuthClient().$fetch("/login-method", {
      method: "POST",
      body: { email: normalizeEmail(email) },
    })
    return classifyLoginMethod(result.data)
  } catch {
    return { kind: "password" }
  }
}

export type EmailAuthOutcome =
  | { status: "success" }
  | { status: "failed"; reason: EmailAuthFailure }

async function completeEmailAuth(
  attempt: () => Promise<{
    data: { user: SignedInUserPayload } | null
    error?: { code?: string | null; message?: string | null } | null
  }>,
): Promise<EmailAuthOutcome> {
  let result: Awaited<ReturnType<typeof attempt>>
  try {
    result = await attempt()
  } catch {
    return { status: "failed", reason: "retryable" }
  }
  if (result.error) {
    return { status: "failed", reason: classifyEmailAuthFailure(result.error) }
  }
  if (!result.data?.user) return { status: "failed", reason: "retryable" }
  // The error is already classified above; hand on the success half so the
  // shared path applies the session, the R15 notice, and the RUM action.
  const data = result.data
  const outcome = await completeSignIn(async () => ({ data }))
  return outcome.status === "success"
    ? { status: "success" }
    : { status: "failed", reason: "retryable" }
}

export function signInWithEmail(
  email: string,
  password: string,
): Promise<EmailAuthOutcome> {
  return completeEmailAuth(() =>
    getAuthClient().signIn.email({ email: normalizeEmail(email), password }),
  )
}

export function signUpWithEmail(
  email: string,
  password: string,
): Promise<EmailAuthOutcome> {
  const normalized = normalizeEmail(email)
  return completeEmailAuth(() =>
    getAuthClient().signUp.email({
      email: normalized,
      password,
      // Better Auth requires a name; auth derives a display name server-side
      // and the user can never see this placeholder before it is replaced.
      name: normalized.split("@")[0] ?? normalized,
    }),
  )
}

/**
 * Hosted-page sign-in (F2): the jfp self-RP flow. The Expo client opens
 * the browser sheet itself and captures the session cookie from the
 * forgemobile:// callback; afterwards an outcome-reporting session read
 * (KTD6) determines who — if anyone — signed in.
 */
async function runHostedSignIn(): Promise<SignInOutcome> {
  try {
    const result = await getAuthClient().signIn.oauth2({
      providerId: "jfp",
      callbackURL: "/",
    })
    if (result.error) return { status: "error" }
  } catch (error) {
    return toSignInOutcome(error)
  }
  const store = getAuthSession()
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
  // R15 on the hosted path: both stamps are server clocks (KTD3).
  if (wasAccountCreatedThisSignIn(user.createdAt, user.sessionCreatedAt)) {
    noteAccountCreated(user.id)
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
