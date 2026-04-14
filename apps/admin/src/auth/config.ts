import { betterAuth } from "better-auth"
import { toNextJsHandler, nextCookies } from "better-auth/next-js"
import { genericOAuth, okta } from "better-auth/plugins"
import { prismaAdapter } from "@better-auth/prisma-adapter"
import { env } from "@/config/env"
import { prisma } from "@/db/client"

const socialProviders = {
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          disableSignUp: true,
        },
      }
    : {}),
  ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
    ? {
        apple: {
          clientId: env.APPLE_CLIENT_ID,
          clientSecret: env.APPLE_CLIENT_SECRET,
          disableSignUp: true,
        },
      }
    : {}),
}

const plugins = [
  nextCookies(),
  ...(env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER
    ? [
        genericOAuth({
          config: [
            okta({
              clientId: env.OKTA_CLIENT_ID,
              clientSecret: env.OKTA_CLIENT_SECRET,
              issuer: env.OKTA_ISSUER,
              disableSignUp: true,
            }),
          ],
        }),
      ]
    : []),
]

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  secret:
    env.BETTER_AUTH_SECRET ??
    "forge-admin-dev-secret-change-me-before-production",
  baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3003",
  plugins,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  cookies: {
    sessionToken: {
      attributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
      },
    },
  },
  socialProviders,
})

export const authRouteHandlers = toNextJsHandler(auth)
