import type { BetterAuthPlugin } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"

import { JFP_MOBILE_PROVIDER_ID } from "@/auth/mobile-session"

/** oauth-provider endpoints that can send a browser to a redirect_uri. */
const CODE_ISSUING_PATHS = new Set([
  "/oauth2/authorize",
  "/oauth2/consent",
  "/oauth2/continue",
])

/** The redirect a hook sees: a `location` header, or the `{ redirect, url }`
 *  body the provider returns to a fetch caller instead of a 302. */
function redirectTarget(
  responseHeaders: Headers | undefined,
  returned: unknown,
): string | undefined {
  const location = responseHeaders?.get("location")
  if (location) return location
  if (typeof returned !== "object" || returned === null) return undefined
  const body = returned as { redirect?: unknown; url?: unknown }
  return body.redirect === true && typeof body.url === "string"
    ? body.url
    : undefined
}

// Better Auth 1.7 binds every OAuth callback to ONE signed `state` cookie. The
// hosted page's own provider flow (Google/Okta) overwrites and then expires it
// inside the mobile self-RP flow, so `/callback/jfp` failed state_mismatch.
export function selfRpStateCookiePlugin() {
  return {
    id: "self-rp-state-cookie",
    hooks: {
      after: [
        {
          matcher: (context) => CODE_ISSUING_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const target = redirectTarget(
              ctx.context.responseHeaders,
              ctx.context.returned,
            )
            if (!target) return
            // A throw here is not an APIError, so it would 500 every OAuth
            // client on these endpoints; parse both URLs behind one guard.
            let url: URL
            let base: URL
            try {
              url = new URL(target)
              base = new URL(ctx.context.baseURL)
            } catch {
              return
            }
            const isSelfRpCallback =
              url.origin === base.origin &&
              url.pathname ===
                `${base.pathname}/callback/${JFP_MOBILE_PROVIDER_ID}`
            if (!isSelfRpCallback) return
            const state = url.searchParams.get("state")
            // Only a code redirect: an error redirect is routed by the DB row
            // without the cookie, and a code is issued only to a live session.
            if (!state || !url.searchParams.has("code")) return
            // Same cookie generateState plants; the callback's parseState
            // compares it to the `state` query and then expires it.
            const stateCookie = ctx.context.createAuthCookie("state", {
              maxAge: 300,
            })
            await ctx.setSignedCookie(
              stateCookie.name,
              state,
              ctx.context.secret,
              stateCookie.attributes,
            )
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
