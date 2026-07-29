// Gate for the profile/sign-in surface (feat-322). The surface ships dark:
// visible in dev builds always, and in release builds only when the opt-in
// env flag is set (repo convention: new opt-in env vars are `.optional()` so
// unprovisioned environments keep booting). Policy lives in profileFlagState
// (env-free, unit-tested); this module only binds it to the real inputs.

import { env } from "../../env"
import { resolveProfileSurfaceEnabled } from "./profileFlagState"

export function isProfileSurfaceEnabled(): boolean {
  return resolveProfileSurfaceEnabled(
    __DEV__,
    env.EXPO_PUBLIC_TV_PROFILE_ENABLED,
  )
}
