/**
 * Sign-in flows (U6): native Apple/Google sheets plus the hosted-page
 * fallback. Native modules load lazily inside each flow (the root-layout
 * require pattern) so this module imports cleanly under jest; every
 * DECISION lives in authFlows.ts / authSession.ts, both pure-tested.
 *
 * Each flow resolves to a typed outcome the sheet renders: success (with
 * the R15 new-account flag), a quiet cancel, or a retryable error.
 */

import { classifySignInFailure, isNewlyCreatedAccount } from "./authFlows"
import {
  getAuthClient,
  getAuthSession,
  type SignedInUserPayload,
} from "./authSession"
import { env } from "../env"
import { reportDatadogAction } from "./datadog"

export type SignInOutcome =
  | { status: "success"; newAccount: boolean }
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
  // The adoption metric's first RUM action (Success Criteria).
  reportDatadogAction("sign_in_completed", {})
  return {
    status: "success",
    newAccount: isNewlyCreatedAccount(user, Date.now()),
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */

export async function signInWithApple(): Promise<SignInOutcome> {
  const AppleAuthentication =
    require("expo-apple-authentication") as typeof import("expo-apple-authentication")
  let identityToken: string | null | undefined
  let authorizationCode: string | null | undefined
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
    identityToken = credential.identityToken
    authorizationCode = credential.authorizationCode
  } catch (error) {
    return classifySignInFailure("provider-sheet", error) === "cancelled"
      ? { status: "cancelled" }
      : { status: "error" }
  }
  if (!identityToken) return { status: "error" }

  const outcome = await completeSignIn(() =>
    getAuthClient().signIn.social({
      provider: "apple",
      idToken: { token: identityToken },
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
  return { status: "success", newAccount: false }
}

/** Sign out: revoke at auth then clear local session (R4). The progress
 *  lifecycle (store/snapshot/queue reset) reacts to the session change. */
export async function signOut(): Promise<void> {
  await getAuthSession().signOut()
}
