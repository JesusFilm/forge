// The one predicate for the signed-out sign-in entry points (feat-543). The
// rule lives in signInGateState; this module only binds it to the real inputs.

import { env } from "../env"
import { resolveSignInAvailable } from "./signInGateState"

export function isSignInAvailable(): boolean {
  return resolveSignInAvailable(__DEV__, env.EXPO_PUBLIC_SIGN_IN_ENABLED)
}
