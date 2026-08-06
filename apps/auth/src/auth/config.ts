import { prismaAdapter } from "@better-auth/prisma-adapter"
import { oauthProvider } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { toNextJsHandler, nextCookies } from "better-auth/next-js"
import { genericOAuth, jwt, okta } from "better-auth/plugins"

import { agentLoginPlugin } from "@/auth/agent-login-plugin"
import { deviceGrantPlugin } from "@/auth/device-grant-plugin"
import { AUTH_SCOPES } from "@/domain/scopes"
import {
  assertProductionAuthSecrets,
  env,
  getAuthBaseUrl,
  getAuthTrustedOrigins,
  getAuthValidAudiences,
} from "@/config/env"
import { prisma } from "@/db/client"

assertProductionAuthSecrets()

const validAudiences = getAuthValidAudiences()

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
        },
      }
    : {}),
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          prompt: "select_account" as const,
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

const upstreamProviderPlugins =
  env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER
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
    : []

function firstPartyUserClaims(user: {
  actorType?: string | null
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
    "https://jesusfilm.org/claims/actor_type":
      user.actorType === "AGENT" ? "agent" : "human",
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
  trustedOrigins: getAuthTrustedOrigins(),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "facebook", "apple", "okta"],
    },
  },
  user: {
    additionalFields: {
      actorType: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  plugins: [
    jwt(),
    agentLoginPlugin(),
    deviceGrantPlugin(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      // MCP clients such as Codex discover and register OAuth clients at
      // runtime. Keep these enabled so /mcp can be authenticated without an
      // out-of-band OAuth client bootstrap.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
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
          "https://jesusfilm.org/claims/actor_type",
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
        ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  socialProviders,
})

export const authRouteHandlers = toNextJsHandler(auth)
