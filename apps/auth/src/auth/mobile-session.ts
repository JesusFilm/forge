/**
 * Mobile-session identification for the JWT bridge (admin verifies user JWTs
 * against Auth's JWKS and must accept only mobile-app sessions).
 *
 * The jwt plugin's /token endpoint mints off ANY session — web, admin
 * dashboard, chat, and agent sessions included — so the minted JWT needs a
 * claim that distinguishes sessions the mobile app created. Sessions are
 * stamped at creation from the request that created them; the stamp rides the
 * session row and surfaces as a claim via definePayload.
 */

export const JFP_MOBILE_PROVIDER_ID = "jfp"

/** apps/mobile's `app.json` scheme. `MOBILE_APP_SCHEME_ORIGIN` derives from
 *  this so the trusted origin and the session stamp cannot disagree. */
export const MOBILE_APP_SCHEME = "forgemobile"

export const MOBILE_SESSION_CLIENT_KIND = "mobile"

export const MOBILE_CLIENT_CLAIM = "https://jesusfilm.org/claims/client"

const NATIVE_ID_TOKEN_PROVIDERS = new Set(["apple", "google"])

export type SessionCreateRequestContext = {
  path?: string
  body?: unknown
  params?: unknown
  headers?: { get: (name: string) => string | null } | null
  request?: {
    headers?: { get: (name: string) => string | null } | null
  } | null
}

/** Email sign-in/up is shared with web, so the CALLER is the discriminator. */
const EMAIL_CREDENTIAL_PATHS = new Set(["/sign-in/email", "/sign-up/email"])

/**
 * The Expo client sends `expo-origin: <scheme>://` on every request and the
 * expo server plugin copies it into `origin`, which better-auth then checks
 * against trustedOrigins. Reading either spelling means the stamp does not
 * depend on which of the two runs first.
 */
function isMobileOrigin(ctx: SessionCreateRequestContext): boolean {
  const headers = ctx.headers ?? ctx.request?.headers
  if (!headers) return false
  const origin = headers.get("expo-origin") ?? headers.get("origin")
  return origin != null && origin.startsWith(`${MOBILE_APP_SCHEME}://`)
}

/**
 * Mobile-only session entry points:
 * - `/sign-in/social` with a provider idToken — native Apple/Google sheets.
 *   Web and every other first-party app sign in through browser flows and
 *   never post idTokens.
 * - `/callback/jfp` — the self-RP hosted-page fallback; only the
 *   mobile app signs in through the jfp generic-oauth provider.
 * - `/sign-in/email` and `/sign-up/email` FROM the mobile app scheme. These
 *   two are shared with web, so unlike the others the path alone proves
 *   nothing and the origin decides.
 *
 * Every signal here is client-shaped, including the pre-existing idToken
 * check: nothing stops a non-browser caller from claiming to be mobile. That
 * is acceptable because the claim buys only own-data watch-progress access at
 * admin — the same data that caller could already reach as themselves.
 */
export function resolveSessionClientKind(
  ctx: SessionCreateRequestContext | null | undefined,
): typeof MOBILE_SESSION_CLIENT_KIND | undefined {
  if (!ctx?.path) return undefined

  if (EMAIL_CREDENTIAL_PATHS.has(ctx.path) && isMobileOrigin(ctx)) {
    return MOBILE_SESSION_CLIENT_KIND
  }

  // The endpoint context carries the route pattern (":providerId"), so the
  // provider id is read from params; the concrete-path form is kept too.
  if (
    ctx.path === `/callback/${JFP_MOBILE_PROVIDER_ID}` ||
    ctx.path === `/oauth2/callback/${JFP_MOBILE_PROVIDER_ID}` ||
    ((ctx.path.startsWith("/callback") ||
      ctx.path.startsWith("/oauth2/callback")) &&
      (ctx.params as { providerId?: string } | undefined)?.providerId ===
        JFP_MOBILE_PROVIDER_ID)
  ) {
    return MOBILE_SESSION_CLIENT_KIND
  }

  if (ctx.path === "/sign-in/social") {
    const body = ctx.body
    if (typeof body !== "object" || body === null) return undefined
    const { idToken, provider } = body as {
      idToken?: unknown
      provider?: unknown
    }
    if (!idToken) return undefined
    if (
      typeof provider === "string" &&
      NATIVE_ID_TOKEN_PROVIDERS.has(provider)
    ) {
      return MOBILE_SESSION_CLIENT_KIND
    }
  }

  return undefined
}

type JwtSessionInput = {
  user: { id: string }
  session: Record<string, unknown>
}

/**
 * Lean by design: admin needs only the subject and the client claim, and the
 * plugin's default payload would leak email/name into a bearer artifact.
 */
export function defineMobileAwareJwtPayload(session: JwtSessionInput) {
  const clientKind = (session.session as { clientKind?: string | null })
    .clientKind
  return {
    sub: session.user.id,
    ...(clientKind === MOBILE_SESSION_CLIENT_KIND
      ? { [MOBILE_CLIENT_CLAIM]: MOBILE_SESSION_CLIENT_KIND }
      : {}),
  }
}
