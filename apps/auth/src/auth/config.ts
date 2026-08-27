import { expo } from "@better-auth/expo"
import { prismaAdapter } from "@better-auth/prisma-adapter"
import { oauthProvider } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { toNextJsHandler, nextCookies } from "better-auth/next-js"
import { genericOAuth, jwt, okta } from "better-auth/plugins"

import { agentLoginPlugin } from "@/auth/agent-login-plugin"
import { deviceGrantPlugin } from "@/auth/device-grant-plugin"
import { mobileAppleCredentialPlugin } from "@/auth/mobile-apple-plugin"
import {
  JFP_MOBILE_PROVIDER_ID,
  defineMobileAwareJwtPayload,
  resolveSessionClientKind,
} from "@/auth/mobile-session"
import {
  MOBILE_LOCAL_CLIENT_ID,
  MOBILE_PRODUCTION_CLIENT_ID,
  MOBILE_DEFAULT_SCOPES,
} from "@/domain/apps"
import { AUTH_SCOPES } from "@/domain/scopes"
import {
  createOAuthResourceCatalog,
  getPublicDcrAllowedScopes,
  getPublicDcrResources,
  resolveOAuthResource,
} from "@/domain/oauth-resources"
import { CHANGELOG_OAUTH_SCOPES } from "@/services/oauth-policy.service"
import { createChangelogOAuthGrantDecision } from "@/services/changelog-oauth-grant.service"
import { buildAccountDeletionHooks } from "@/services/account-deletion.service"
import {
  assertProductionAuthSecrets,
  env,
  getAdminWatchProgressErasureConfig,
  getAppleNativeClientConfig,
  getAuthBaseUrl,
  getAuthCustomAudiences,
  getAuthTrustedOrigins,
} from "@/config/env"
import { prisma } from "@/db/client"

assertProductionAuthSecrets()

const protectedResources = createOAuthResourceCatalog({
  authIssuer: getAuthBaseUrl(),
  customAudiences: getAuthCustomAudiences(),
})
const publicDcrResources = getPublicDcrResources(protectedResources)
const publicDcrAllowedScopes = getPublicDcrAllowedScopes(protectedResources)
const accountDeletionHooks = buildAccountDeletionHooks({
  findAppleAccount: (userId) =>
    prisma.account.findFirst({
      where: { userId, providerId: "apple" },
      select: { refreshToken: true },
    }),
  getAppleConfig: getAppleNativeClientConfig,
  getAdminErasureConfig: getAdminWatchProgressErasureConfig,
})

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
const betterAuthSecret =
  env.BETTER_AUTH_SECRET ??
  (isNextBuild ? "build-time-placeholder-not-used-at-runtime" : undefined)

/**
 * Apple has two independent credential pairs, and either alone is enough to
 * register the provider: the web Service ID (browser flow) and the app bundle
 * id (native sheet). clientId and clientSecret must stay MATCHED — Apple
 * requires the secret JWT's `sub` to equal the client_id presented at its
 * token endpoint — so they are resolved as a pair, never mixed.
 */
const appleWebCredentials =
  env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
    ? { clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET }
    : null
const appleNativeCredentials =
  env.APPLE_APP_BUNDLE_ID && env.APPLE_NATIVE_CLIENT_SECRET
    ? {
        clientId: env.APPLE_APP_BUNDLE_ID,
        clientSecret: env.APPLE_NATIVE_CLIENT_SECRET,
      }
    : null
// The web Service ID drives the browser authorization URL when present; a
// native-only deploy falls back to the bundle id, and the hosted login page
// correctly keeps Apple disabled there (it gates on APPLE_CLIENT_ID).
const appleCredentials = appleWebCredentials ?? appleNativeCredentials
// Verify identity tokens minted for EITHER id, independent of which pair
// drives the browser flow.
const appleAudience = [
  ...(env.APPLE_CLIENT_ID ? [env.APPLE_CLIENT_ID] : []),
  ...(env.APPLE_APP_BUNDLE_ID ? [env.APPLE_APP_BUNDLE_ID] : []),
]

/**
 * Apple sends `email` in the identity token only on a user's FIRST
 * authorization; every later one carries just `sub`. Better Auth reads the
 * email straight off that token and rejects the whole sign-in when it is
 * absent ("User email not found", 401) — before it ever looks up the linked
 * account — so a returning user would be permanently locked out, which bites
 * hardest right after an account deletion.
 *
 * mapProfileToUser is the only hook that runs after Apple's provider sets
 * `email: profile.email`, so it is where the stored address is restored. The
 * identity token's signature is verified before this runs, making `sub`
 * trustworthy as the lookup key. Returning `{}` leaves Better Auth's own
 * value untouched — it must never blank a stored email.
 */
async function appleProfileToUser(profile: { sub?: string; email?: string }) {
  if (profile.email) return { email: profile.email }
  if (!profile.sub) return {}

  const account = await prisma.account.findUnique({
    where: {
      providerId_accountId: { providerId: "apple", accountId: profile.sub },
    },
    select: { user: { select: { email: true } } },
  })
  if (!account?.user.email) return {}

  console.warn(
    "[auth] event=apple_email_restored_from_account reason=token_omitted_email",
  )
  return { email: account.user.email }
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
          // Mobile's native SDKs use this id as webClientId, so native
          // identity tokens already arrive with aud = GOOGLE_CLIENT_ID.
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          prompt: "select_account" as const,
        },
      }
    : {}),
  ...(appleCredentials
    ? {
        // App Store guideline 4.8: the hosted page is mobile's ONLY login,
        // so Apple must stay enabled here while the app is in the store.
        // An expired Apple secret now breaks mobile login compliance.
        apple: {
          ...appleCredentials,
          audience: appleAudience,
          mapProfileToUser: appleProfileToUser,
        },
      }
    : {}),
}

// Mobile's hosted-page sign-in (the only mobile login since feat-349): Auth
// acts as OAuth client toward its own oauth-provider (self-RP), so any
// hosted sign-in method ends in a real Better Auth session the Expo plugin
// can hand back to the app.
const jfpMobileSelfProvider = {
  providerId: JFP_MOBILE_PROVIDER_ID,
  discoveryUrl: `${getAuthBaseUrl()}/.well-known/openid-configuration`,
  requireIdTokenVerification: true,
  clientId:
    process.env.NODE_ENV === "production"
      ? MOBILE_PRODUCTION_CLIENT_ID
      : MOBILE_LOCAL_CLIENT_ID,
  scopes: [...MOBILE_DEFAULT_SCOPES],
  redirectURI: `${getAuthBaseUrl()}/api/auth/callback/${JFP_MOBILE_PROVIDER_ID}`,
  pkce: true,
  // R5 (feat-349): always show the login form, even with a live browser
  // session — sign-out must allow account switching on a shared device.
  // `as const` keeps the literal from widening to `string`, which fails the
  // GenericOAuthConfig.prompt union and breaks `@forge/auth` typecheck.
  prompt: "login" as const,
}

const upstreamProviderPlugins = [
  genericOAuth({
    config: [
      jfpMobileSelfProvider,
      ...(env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER
        ? [
            okta({
              clientId: env.OKTA_CLIENT_ID,
              clientSecret: env.OKTA_CLIENT_SECRET,
              issuer: env.OKTA_ISSUER,
            }),
          ]
        : []),
    ],
  }),
]

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
      user.membershipStatus?.toLowerCase() ?? "invited",
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
      // Consumer providers link only when they assert a verified email (R1);
      // okta and the jfp self-RP are internal identity assertions — jfp's
      // userinfo email IS the matched user row's own (unique) email.
      trustedProviders: ["okta", JFP_MOBILE_PROVIDER_ID],
    },
  },
  user: {
    additionalFields: {
      actorType: {
        type: "string",
        required: false,
        input: false,
      },
      membershipStatus: {
        type: "string",
        required: false,
        input: false,
      },
    },
    // No mailer platform-wide, so intent is verified by a fresh session
    // instead of an email (auth-owner direction, 2026-08-04). Side effects
    // are beforeDelete: a failure aborts with the account intact.
    deleteUser: {
      enabled: true,
      beforeDelete: accountDeletionHooks.beforeDelete,
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          const clientKind = resolveSessionClientKind(
            (ctx ?? undefined) as { path?: string; body?: unknown } | undefined,
          )
          if (!clientKind) return
          return { data: { ...session, clientKind } }
        },
      },
    },
  },
  plugins: [
    expo(),
    // Lean payload + short expiry: sign-out revokes the session but an
    // already-minted JWT lives to its exp — 15m bounds that window (KTD1).
    jwt({
      jwt: {
        expirationTime: "15m",
        definePayload: defineMobileAwareJwtPayload,
      },
    }),
    agentLoginPlugin(),
    deviceGrantPlugin(),
    mobileAppleCredentialPlugin(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      // MCP clients such as Codex discover and register OAuth clients at
      // runtime. Keep these enabled so /mcp can be authenticated without an
      // out-of-band OAuth client bootstrap.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      scopes: AUTH_SCOPES.map((scope) => scope.key),
      // Next's build phase has no runtime database. Resource seeding belongs
      // to server startup after migrations, not static route collection.
      resources: isNextBuild
        ? []
        : protectedResources.map(({ identifier, allowedScopes }) => ({
            identifier,
            allowedScopes: [...allowedScopes],
          })),
      clientRegistrationAllowedResources: isNextBuild ? [] : publicDcrResources,
      clientRegistrationDefaultResources: isNextBuild ? [] : publicDcrResources,
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
      clientRegistrationAllowedScopes: publicDcrAllowedScopes,
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
      customAccessTokenClaims: async ({
        user,
        scopes,
        resources,
        metadata,
      }) => {
        const target =
          resources?.length === 1
            ? resolveOAuthResource(protectedResources, resources[0])
            : undefined
        if (target?.resourceClass === "admin-mcp") {
          return {
            "https://jesusfilm.org/claims/environment":
              target.trustedEnvironment,
            "https://jesusfilm.org/claims/app": target.trustedApp,
          }
        }
        const changelogAware =
          target?.resourceClass === "changelog-mcp" ||
          (resources?.length !== 1 &&
            scopes.some((scope) =>
              CHANGELOG_OAUTH_SCOPES.includes(
                scope as (typeof CHANGELOG_OAUTH_SCOPES)[number],
              ),
            ))
        if (!changelogAware) {
          return {
            ...(typeof metadata?.environmentKind === "string"
              ? {
                  "https://jesusfilm.org/claims/environment":
                    metadata.environmentKind,
                }
              : {}),
            ...(typeof metadata?.appKey === "string"
              ? { "https://jesusfilm.org/claims/app": metadata.appKey }
              : {}),
          }
        }

        const decision = await createChangelogOAuthGrantDecision({
          lifecycle: "exchange",
          userId: user?.id,
          membershipStatus: user?.membershipStatus,
          requestedScopes: scopes,
          resources,
          scopeCeiling: scopes,
        })
        if (
          !decision.allowed ||
          decision.scopes.length !== scopes.length ||
          decision.scopes.some((scope, index) => scope !== scopes[index])
        ) {
          throw new APIError("BAD_REQUEST", {
            error: "invalid_grant",
            error_description: "Changelog access is no longer available.",
          })
        }

        return {
          "https://jesusfilm.org/claims/environment":
            decision.target.environmentKind,
          "https://jesusfilm.org/claims/app": "changelog",
        }
      },
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
    additionalFields: {
      // Stamped at creation for mobile entry points; surfaces as the JWT's
      // client claim so admin can bind acceptance to mobile sessions.
      clientKind: {
        type: "string",
        required: false,
        input: false,
      },
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
