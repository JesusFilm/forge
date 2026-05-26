import { prismaAdapter } from "@better-auth/prisma-adapter"
import { oauthProvider } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { toNextJsHandler, nextCookies } from "better-auth/next-js"
import { genericOAuth, jwt, okta } from "better-auth/plugins"

import { AUTH_SCOPES } from "@/domain/scopes"
import { assertProductionAuthSecrets, env, getAuthBaseUrl } from "@/config/env"
import { prisma } from "@/db/client"

assertProductionAuthSecrets()

const validAudiences = [
  getAuthBaseUrl(),
  ...(env.AUTH_VALID_AUDIENCES ?? "")
    .split(",")
    .map((audience) => audience.trim())
    .filter((audience) => audience.length > 0),
]

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
const betterAuthSecret =
  env.BETTER_AUTH_SECRET ??
  (isNextBuild ? "build-time-placeholder-not-used-at-runtime" : undefined)

const socialProviders = {
  ...(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET
    ? {
        facebook: {
          clientId: env.FACEBOOK_CLIENT_ID,
          clientSecret: env.FACEBOOK_CLIENT_SECRET,
          disableSignUp: true,
        },
      }
    : {}),
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

const upstreamProviderPlugins =
  env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER
    ? [
        genericOAuth({
          config: [
            okta({
              clientId: env.OKTA_CLIENT_ID,
              clientSecret: env.OKTA_CLIENT_SECRET,
              disableSignUp: true,
              issuer: env.OKTA_ISSUER,
            }),
          ],
        }),
      ]
    : []

function firstPartyUserClaims(user: {
  email?: string | null
  emailVerified?: boolean | null
  name?: string | null
  image?: string | null
  membershipStatus?: string | null
}) {
  return {
    email: user.email ?? undefined,
    email_verified: user.emailVerified ?? undefined,
    name: user.name ?? undefined,
    picture: user.image ?? undefined,
    "https://jesusfilm.org/claims/membership_status":
      user.membershipStatus ?? "invited",
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  secret: betterAuthSecret,
  baseURL: getAuthBaseUrl(),
  trustedOrigins: [getAuthBaseUrl()],
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "facebook", "apple", "okta"],
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: AUTH_SCOPES.map((scope) => scope.key),
      validAudiences,
      advertisedMetadata: {
        scopes_supported: AUTH_SCOPES.map((scope) => scope.key),
        claims_supported: [
          "sub",
          "iss",
          "aud",
          "exp",
          "iat",
          "sid",
          "scope",
          "azp",
          "email",
          "email_verified",
          "name",
          "picture",
          "https://jesusfilm.org/claims/membership_status",
          "https://jesusfilm.org/claims/environment",
          "https://jesusfilm.org/claims/app",
        ],
      },
      clientRegistrationDefaultScopes: ["openid", "profile:read", "email:read"],
      clientRegistrationAllowedScopes: AUTH_SCOPES.map((scope) => scope.key),
      clientCredentialGrantDefaultScopes: ["openid"],
      accessTokenExpiresIn: 60 * 60,
      m2mAccessTokenExpiresIn: 60 * 30,
      idTokenExpiresIn: 60 * 60,
      codeExpiresIn: 60 * 10,
      prefix: {
        opaqueAccessToken: "jfp_at_",
        refreshToken: "jfp_rt_",
        clientSecret: "jfp_cs_",
      },
      silenceWarnings: {
        oauthAuthServerConfig: true,
      },
      customIdTokenClaims: ({ user }) => firstPartyUserClaims(user),
      customUserInfoClaims: ({ user }) => firstPartyUserClaims(user),
      customAccessTokenClaims: ({ metadata }) => ({
        ...(typeof metadata?.serviceAudience === "string"
          ? { aud: metadata.serviceAudience }
          : {}),
        ...(typeof metadata?.environmentKind === "string"
          ? {
              "https://jesusfilm.org/claims/environment":
                metadata.environmentKind,
            }
          : {}),
        ...(typeof metadata?.appKey === "string"
          ? { "https://jesusfilm.org/claims/app": metadata.appKey }
          : {}),
      }),
    }),
    nextCookies(),
    ...upstreamProviderPlugins,
  ],
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
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  socialProviders,
})

export const authRouteHandlers = toNextJsHandler(auth)
