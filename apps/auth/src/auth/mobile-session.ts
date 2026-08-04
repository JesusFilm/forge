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

export const MOBILE_SESSION_CLIENT_KIND = "mobile"

export const MOBILE_CLIENT_CLAIM = "https://jesusfilm.org/claims/client"

const NATIVE_ID_TOKEN_PROVIDERS = new Set(["apple", "google"])

export type SessionCreateRequestContext = {
  path?: string
  body?: unknown
  params?: unknown
}

/**
 * Mobile-only session entry points:
 * - `/sign-in/social` with a provider idToken — native Apple/Google sheets.
 *   Web and every other first-party app sign in through browser flows
 *   (`/callback/:provider`, `/sign-in/email`) and never post idTokens.
 * - `/oauth2/callback/jfp` — the self-RP hosted-page fallback; only the
 *   mobile app signs in through the jfp generic-oauth provider.
 */
export function resolveSessionClientKind(
  ctx: SessionCreateRequestContext | null | undefined,
): typeof MOBILE_SESSION_CLIENT_KIND | undefined {
  if (!ctx?.path) return undefined

  // The endpoint context carries the route pattern (":providerId"), so the
  // provider id is read from params; the concrete-path form is kept too.
  if (
    ctx.path === `/oauth2/callback/${JFP_MOBILE_PROVIDER_ID}` ||
    (ctx.path.startsWith("/oauth2/callback") &&
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
