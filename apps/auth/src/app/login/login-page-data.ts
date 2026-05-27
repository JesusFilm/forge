import { env } from "@/config/env"
import { prisma } from "@/db/client"

import type { LoginErrorCode } from "@/app/login/login-page-client"
import type { LoginProviderId } from "@/auth/login-methods"

export type LoginSearchParams = Record<string, string | string[] | undefined>

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function isOAuthAuthorizeRequest(params: LoginSearchParams) {
  return Boolean(
    firstParam(params.client_id) && firstParam(params.redirect_uri),
  )
}

export function parseLoginError(
  value: string | undefined,
): LoginErrorCode | undefined {
  return value === "account_not_linked" ||
    value === "credentials" ||
    value === "forbidden"
    ? value
    : undefined
}

export function toOAuthQuery(params: LoginSearchParams) {
  const oauthQuery = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (key === "error") continue
    if (Array.isArray(value)) {
      for (const item of value) oauthQuery.append(key, item)
    } else if (value) {
      oauthQuery.set(key, value)
    }
  }
  return oauthQuery.toString()
}

export function getEnabledProviders(): LoginProviderId[] {
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

export async function resolveRequestingAppName(
  clientId: string | undefined,
): Promise<string | null> {
  if (!clientId || !env.DATABASE_URL) return null

  try {
    const environment = await prisma.appEnvironment.findUnique({
      where: { clientId },
      select: {
        app: {
          select: {
            displayName: true,
          },
        },
      },
    })

    return environment?.app.displayName ?? null
  } catch {
    console.warn("[auth-login] requesting_app_lookup_failed")
    return null
  }
}
