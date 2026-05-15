import { env } from "@/config/env"
import { redirect } from "next/navigation"
import {
  LoginPageClient,
  type LoginErrorCode,
  type LoginProviderId,
} from "@/app/login/login-page-client"

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function isOAuthAuthorizeRequest(
  params: Record<string, string | string[] | undefined>,
) {
  return Boolean(
    firstParam(params.client_id) && firstParam(params.redirect_uri),
  )
}

function parseLoginError(
  value: string | undefined,
): LoginErrorCode | undefined {
  return value === "account_not_linked" || value === "forbidden"
    ? value
    : undefined
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
  if (!isOAuthAuthorizeRequest(params)) {
    redirect("https://www.jesusfilm.org")
  }

  return (
    <LoginPageClient
      enabledProviders={getEnabledProviders()}
      initialError={parseLoginError(firstParam(params.error))}
    />
  )
}
