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
  type SignedInUserPayload,
} from "./authSession"
import { env } from "../env"
import { reportDatadogAction } from "./datadog"
import { noteAccountCreated, wasAccountJustCreated } from "./newAccountNotice"

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
    return classifySignInFailure("provider-sheet", error) === "cancelled"
      ? { status: "cancelled" }
      : { status: "error" }
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
    return classifySignInFailure("provider-sheet", error) === "cancelled"
      ? { status: "cancelled" }
      : { status: "error" }
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
 * Hosted-page fallback (F2): the jfp self-RP flow. The Expo client opens
 * the browser sheet itself and captures the session cookie from the
 * forgemobile:// callback; afterwards the session refresh reads who
 * signed in.
 */
export async function signInWithHostedPage(): Promise<SignInOutcome> {
  try {
    const result = await getAuthClient().signIn.oauth2({
      providerId: "jfp",
      callbackURL: "/",
    })
    if (result.error) return { status: "error" }
  } catch (error) {
    return classifySignInFailure("provider-sheet", error) === "cancelled"
      ? { status: "cancelled" }
      : { status: "error" }
  }
  const store = getAuthSession()
  await store.refresh()
  const snapshot = store.getSnapshot()
  if (snapshot.status !== "signedIn") {
    // The browser sheet was dismissed without completing — a quiet cancel.
    return { status: "cancelled" }
  }
  reportDatadogAction("sign_in_completed", {})
  return { status: "success" }
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
