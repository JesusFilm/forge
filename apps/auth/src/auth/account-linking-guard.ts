import { APIError } from "better-auth/api"

/** Wire error code; the OAuth callback redirects with `?error=<code>`. */
export const CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL =
  "CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL"

export type AccountLinkCandidate = { providerId: string; userId: string }

export type ConsumerLinkGuardDeps = {
  /** Provider ids whose identity is a third-party assertion (google, apple…). */
  consumerProviders: ReadonlySet<string>
  findUser: (
    userId: string,
  ) => Promise<{ emailVerified?: boolean | null } | null | undefined>
  findAccounts: (userId: string) => Promise<ReadonlyArray<unknown>>
}

// This app disables 1.7's "local email must be verified" link rule for the jfp
// self-RP. Keep that rule for consumer providers, or a pre-registered password
// row with a victim's email captures the victim's later Google/Apple sign-in.
export async function refuseUnverifiedConsumerLink(
  account: AccountLinkCandidate,
  deps: ConsumerLinkGuardDeps,
): Promise<void> {
  if (!deps.consumerProviders.has(account.providerId)) return
  const user = await deps.findUser(account.userId)
  if (user?.emailVerified) return
  // A fresh consumer sign-up creates the user in the same flow and has no
  // account row yet; only an EXISTING identity is a link target.
  const existing = await deps.findAccounts(account.userId)
  if (user != null && existing.length === 0) return
  throw new APIError("FORBIDDEN", {
    code: CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL,
    message:
      "This email was registered without verification. Sign in with your password instead.",
  })
}
