import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { env } from "@/config/env"

export type AdminOAuthConfig = {
  issuerUrl: string
  clientId: string
  clientSecret?: string
  adminBaseUrl: string
}

export type VerifiedAdminToken = {
  subject: string
  email?: string
  name?: string
  scopes: string[]
  claims: JWTPayload
}

export function getAdminOAuthConfig(): AdminOAuthConfig | null {
  if (
    env.ADMIN_AUTH_MODE !== "oauth" ||
    !env.AUTH_ISSUER_URL ||
    !env.AUTH_ADMIN_CLIENT_ID
  ) {
    return null
  }

  return {
    issuerUrl: env.AUTH_ISSUER_URL.replace(/\/$/, ""),
    clientId: env.AUTH_ADMIN_CLIENT_ID,
    clientSecret: env.AUTH_ADMIN_CLIENT_SECRET,
    adminBaseUrl: env.ADMIN_BASE_URL ?? "http://localhost:3003",
  }
}

export function getAdminOAuthRedirectUri(config: AdminOAuthConfig) {
  return `${config.adminBaseUrl.replace(/\/$/, "")}/api/auth/callback`
}

export function buildAdminAuthorizeUrl({
  config,
  state,
  codeChallenge,
  callbackUrl,
}: {
  config: AdminOAuthConfig
  state: string
  codeChallenge: string
  callbackUrl?: string
}) {
  const url = new URL("/api/auth/oauth2/authorize", config.issuerUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", getAdminOAuthRedirectUri(config))
  url.searchParams.set("response_type", "code")
  url.searchParams.set(
    "scope",
    [
      "openid",
      "profile:read",
      "email:read",
      "membership:read",
      "admin:access",
      "admin:content:read",
      "admin:content:write",
    ].join(" "),
  )
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (callbackUrl) {
    url.searchParams.set("callbackURL", callbackUrl)
  }

  return url
}

export async function exchangeAdminAuthorizationCode({
  config,
  code,
  codeVerifier,
}: {
  config: AdminOAuthConfig
  code: string
  codeVerifier: string
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getAdminOAuthRedirectUri(config),
    client_id: config.clientId,
    code_verifier: codeVerifier,
  })

  const headers: HeadersInit = {
    "content-type": "application/x-www-form-urlencoded",
  }

  if (config.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64")}`
  }

  const response = await fetch(
    new URL("/api/auth/oauth2/token", config.issuerUrl),
    {
      method: "POST",
      headers,
      body,
    },
  )

  if (!response.ok) {
    throw new Error("Auth code exchange failed.")
  }

  return response.json() as Promise<{
    access_token: string
    id_token?: string
    scope?: string
  }>
}

export async function verifyAdminIdToken({
  config,
  idToken,
  accessToken,
  scope,
}: {
  config: AdminOAuthConfig
  idToken?: string
  accessToken: string
  scope?: string
}): Promise<VerifiedAdminToken> {
  const token = idToken ?? accessToken
  const jwks = createRemoteJWKSet(new URL("/api/auth/jwks", config.issuerUrl))
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuerUrl,
    audience: config.clientId,
  })
  const scopes = (scope ?? payload.scope ?? "")
    .toString()
    .split(" ")
    .filter(Boolean)

  if (!payload.sub || !scopes.includes("admin:access")) {
    throw new Error("Auth token is missing the admin access grant.")
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    scopes,
    claims: payload,
  }
}
