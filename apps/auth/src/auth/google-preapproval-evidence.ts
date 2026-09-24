import { google, verifyGoogleIdToken } from "better-auth/social-providers"

type GoogleEvidence = { googleEmail: string; googleSubject: string }

/** Evidence is request-local until a successful sign-in creates its session. */
export function googlePreapprovalSignIn(clientId: string) {
  const evidence = new WeakMap<object, GoogleEvidence>()
  return {
    // Better Auth's browser callback normally decodes the token returned by
    // Google's token endpoint. Verify it explicitly before retaining evidence;
    // native token sign-in also keeps Better Auth's nonce verification.
    async getUserInfo(tokens: { idToken?: string }) {
      if (!tokens.idToken) return null
      const profile = await verifyGoogleIdToken({
        token: tokens.idToken,
        audience: clientId,
      })
      if (
        !profile ||
        typeof profile.exp !== "number" ||
        profile.exp <= Date.now() / 1000 ||
        typeof profile.sub !== "string" ||
        typeof profile.email !== "string"
      )
        return null
      return google({ clientId }).getUserInfo(tokens)
    },
    capture(
      source: {
        method: string
        oauth?: { providerId: string; profile?: Record<string, unknown> }
      },
      context: object,
    ) {
      if (source.method !== "oauth" || source.oauth?.providerId !== "google")
        return
      const profile = source.oauth.profile
      if (
        !profile ||
        typeof profile.email !== "string" ||
        typeof profile.sub !== "string"
      )
        return
      const email = profile.email.trim().toLowerCase()
      // No Gmail dot/plus folding, alias matching or inference from domains.
      if (
        profile.email_verified === true &&
        (email.endsWith("@gmail.com") ||
          (typeof profile.hd === "string" && profile.hd.trim().length > 0))
      ) {
        evidence.set(context, {
          googleEmail: email,
          googleSubject: profile.sub,
        })
      }
    },
    evidence: (context: object) => evidence.get(context),
  }
}
