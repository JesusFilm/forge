import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"

import { prisma } from "@/db/client"
import { getAppleNativeClientConfig } from "@/config/env"
import { MOBILE_SESSION_CLIENT_KIND } from "@/auth/mobile-session"
import { exchangeAppleAuthorizationCode } from "@/services/apple-native.service"

/**
 * Native Apple sign-in verifies only the identityToken, so no revocable
 * credential lands on the account row. The app posts the sheet's one-time
 * authorizationCode here right after sign-in; the server-side exchange stores
 * the refresh token that account deletion later revokes (Apple's guidance).
 */
export function mobileAppleCredentialPlugin() {
  return {
    id: "mobile-apple-credential",
    endpoints: {
      attachAppleNativeCredential: createAuthEndpoint(
        "/mobile/apple/native-credential",
        {
          method: "POST",
          use: [sessionMiddleware],
          body: z.object({
            authorizationCode: z.string().min(1),
          }),
        },
        async (ctx) => {
          const config = getAppleNativeClientConfig()
          if (!config) {
            return ctx.json(
              { error: "Apple native credential exchange is not configured" },
              { status: 503 },
            )
          }

          const session = ctx.context.session
          const clientKind = (session.session as { clientKind?: string | null })
            .clientKind
          if (clientKind !== MOBILE_SESSION_CLIENT_KIND) {
            return ctx.json(
              { error: "Only mobile sessions can attach native credentials" },
              { status: 403 },
            )
          }

          const appleAccount = await prisma.account.findFirst({
            where: { userId: session.user.id, providerId: "apple" },
            select: { id: true },
          })
          if (!appleAccount) {
            return ctx.json(
              { error: "No Apple account linked to this user" },
              { status: 404 },
            )
          }

          const result = await exchangeAppleAuthorizationCode(
            config,
            ctx.body.authorizationCode,
          )
          if (!result.ok) {
            return ctx.json(
              { error: "Apple authorization code exchange failed" },
              { status: 502 },
            )
          }

          await prisma.account.update({
            where: { id: appleAccount.id },
            data: {
              refreshToken: result.refreshToken,
              ...(result.accessToken
                ? { accessToken: result.accessToken }
                : {}),
              ...(result.accessTokenExpiresAt
                ? { accessTokenExpiresAt: result.accessTokenExpiresAt }
                : {}),
            },
          })

          return ctx.json({ success: true })
        },
      ),
    },
  }
}
