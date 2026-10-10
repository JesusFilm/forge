import "server-only"
import type { ChatIdentity } from "@/auth/session-cookie"

/** Compose the existing Seeker decision with the temporary comparison roster. */
export function comparisonAllowed(
  identity: ChatIdentity | null,
  seekerEnabled: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const email = identity?.email?.trim().toLowerCase()
  return (
    env.APOLOGIST_COMPARE_ENABLED === "true" &&
    seekerEnabled &&
    identity?.emailVerified === true &&
    !!email &&
    (env.APOLOGIST_ALLOWED_EMAILS ?? "")
      .split(",")
      .some((entry) => entry.trim().toLowerCase() === email)
  )
}
