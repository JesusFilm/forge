import { headers as nextHeaders } from "next/headers"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { env } from "@/config/env"
import {
  ADMIN_OAUTH_CALLBACK_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_OAUTH_VERIFIER_COOKIE,
  adminOAuthCookieOptions,
} from "@/auth/auth-session"
import {
  buildAdminAuthorizeUrl,
  getAdminOAuthConfig,
} from "@/auth/oauth-client"
import { createOAuthState } from "@/auth/oauth-state"
import {
  getAuthBaseURL,
  getDefaultPostLoginURL,
  getLoginDestinationName,
  isTrustedAuthOrigin,
  resolveAuthCallbackURL,
} from "@/auth/origins"
import {
  LoginPageClient,
  type LoginProviderId,
} from "@/app/login/login-page-client"

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getRequestOrigin(headers: Headers): string | undefined {
  const host = headers.get("x-forwarded-host") ?? headers.get("host")
  if (!host) {
    return undefined
  }

  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const proto =
    forwardedProto ?? (host.startsWith("localhost") ? "http" : "https")

  return `${proto}://${host}`
}

function getEnabledProviders(): LoginProviderId[] {
  const providers: LoginProviderId[] = []

  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) {
    providers.push("facebook")
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push("google")
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    providers.push("apple")
  }
  if (env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER) {
    providers.push("okta")
  }

  return providers
}

export default async function LoginPage({ searchParams }: LoginPageProps = {}) {
  const params = (await searchParams) ?? {}
  const authBaseURL = getAuthBaseURL()
  const requestOrigin = getRequestOrigin(await nextHeaders()) ?? authBaseURL
  const callbackURL = resolveAuthCallbackURL(
    firstParam(params.callbackURL),
    requestOrigin === authBaseURL
      ? getDefaultPostLoginURL()
      : `${requestOrigin}/dashboard`,
  )
  const initialError =
    firstParam(params.error) === "forbidden" ? "forbidden" : undefined
  const oauthConfig = getAdminOAuthConfig()

  if (oauthConfig && !initialError) {
    const state = createOAuthState()
    const cookieStore = await cookies()
    const cookieOptions = adminOAuthCookieOptions()
    cookieStore.set(ADMIN_OAUTH_STATE_COOKIE, state.state, {
      ...cookieOptions,
      maxAge: 60 * 10,
    })
    cookieStore.set(ADMIN_OAUTH_VERIFIER_COOKIE, state.codeVerifier, {
      ...cookieOptions,
      maxAge: 60 * 10,
    })
    cookieStore.set(ADMIN_OAUTH_CALLBACK_COOKIE, callbackURL, {
      ...cookieOptions,
      maxAge: 60 * 10,
    })
    redirect(
      buildAdminAuthorizeUrl({
        config: oauthConfig,
        state: state.state,
        codeChallenge: state.codeChallenge,
        callbackUrl: callbackURL,
      }).toString() as Parameters<typeof redirect>[0],
    )
  }

  if (requestOrigin !== authBaseURL && isTrustedAuthOrigin(requestOrigin)) {
    const url = new URL("/login", authBaseURL)
    url.searchParams.set("callbackURL", callbackURL)
    if (initialError) {
      url.searchParams.set("error", initialError)
    }
    redirect(url.toString() as Parameters<typeof redirect>[0])
  }

  return (
    <LoginPageClient
      authBaseURL={authBaseURL}
      callbackURL={callbackURL}
      destinationName={getLoginDestinationName(callbackURL)}
      enabledProviders={getEnabledProviders()}
      initialError={initialError}
    />
  )
}
