import { betterAuth } from "better-auth"
import { toNextJsHandler, nextCookies } from "better-auth/next-js"
import { genericOAuth, okta } from "better-auth/plugins"
import { prismaAdapter } from "@better-auth/prisma-adapter"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { getAuthBaseURL, getAuthTrustedOrigins } from "@/auth/origins"

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
if (env.NODE_ENV === "production" && !isNextBuild && !env.BETTER_AUTH_SECRET) {
  throw new Error(
    "BETTER_AUTH_SECRET is required in production. " +
      "All sessions would be signed with Better Auth's default key.",
  )
}

const socialProviders = {
  ...(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET
    ? {
        facebook: {
          clientId: env.FACEBOOK_CLIENT_ID,
          clientSecret: env.FACEBOOK_CLIENT_SECRET,
        },
      }
    : {}),
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
    ? {
        apple: {
          clientId: env.APPLE_CLIENT_ID,
          clientSecret: env.APPLE_CLIENT_SECRET,
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
            }),
          ],
        }),
      ]
    : []),
]

const trustedOrigins = getAuthTrustedOrigins()

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: getAuthBaseURL(),
  trustedOrigins,
  advanced: {
    ...(env.AUTH_COOKIE_PREFIX ? { cookiePrefix: env.AUTH_COOKIE_PREFIX } : {}),
  },
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
        ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
      },
    },
  },
  socialProviders,
})

export const authRouteHandlers = toNextJsHandler(auth)
