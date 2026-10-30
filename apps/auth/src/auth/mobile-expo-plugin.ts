import { expo } from "@better-auth/expo"
import { HIDE_METADATA } from "better-auth"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { z } from "zod"

export type MobileAwareExpoPluginOptions = {
  /** The OAuth client id the jfp self-RP generic-oauth provider signs in as. */
  selfRpClientId: string
}

// 1.7's proxy refuses every same-origin authorize URL (login-CSRF hardening),
// and a self-RP authorize URL IS same-origin. Admit only the self-RP client's
// own /oauth2/authorize; all else mirrors @better-auth/expo 1.7.1 routes.ts.
export function mobileAwareExpoPlugin(options: MobileAwareExpoPluginOptions) {
  const upstream = expo()

  const expoAuthorizationProxy = createAuthEndpoint(
    "/expo-authorization-proxy",
    {
      method: "GET",
      query: z.object({
        authorizationURL: z.string(),
        oauthState: z.string().optional(),
      }),
      metadata: HIDE_METADATA,
    },
    async (ctx) => {
      const { authorizationURL, oauthState } = ctx.query
      if (authorizationURL.includes("#")) {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid authorizationURL",
        })
      }
      let url: URL
      try {
        url = new URL(authorizationURL)
      } catch {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid authorizationURL",
        })
      }
      const base = new URL(ctx.context.baseURL)
      const isSelfRpAuthorize =
        url.origin === base.origin &&
        url.pathname === `${base.pathname}/oauth2/authorize` &&
        url.searchParams.get("client_id") === options.selfRpClientId
      if (
        !isSelfRpAuthorize &&
        (url.protocol !== "https:" || url.origin === base.origin)
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid authorizationURL",
        })
      }

      if (oauthState) {
        const oauthStateCookie = ctx.context.createAuthCookie("oauth_state", {
          maxAge: 600,
        })
        ctx.setCookie(
          oauthStateCookie.name,
          oauthState,
          oauthStateCookie.attributes,
        )
        return ctx.redirect(authorizationURL)
      }
      const state = url.searchParams.get("state")
      if (!state) {
        throw new APIError("BAD_REQUEST", { message: "Unexpected error" })
      }
      const stateCookie = ctx.context.createAuthCookie("state", {
        maxAge: 300,
      })
      await ctx.setSignedCookie(
        stateCookie.name,
        state,
        ctx.context.secret,
        stateCookie.attributes,
      )
      return ctx.redirect(authorizationURL)
    },
  )

  return {
    ...upstream,
    endpoints: { ...upstream.endpoints, expoAuthorizationProxy },
  }
}
