import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { env } from "@/config/env"

const tokenExchangeTimeoutMs = 10_000

export type DeveloperOAuthConfig = {
  issuerUrl: string
  clientId: string
  clientSecret?: string
  developerBaseUrl: string
}

export type VerifiedDeveloperToken = {
  subject: string
  email?: string
  name?: string
  scopes: string[]
  claims: JWTPayload
}

export function getDeveloperOAuthConfig(): DeveloperOAuthConfig {
  return {
    issuerUrl: env.AUTH_ISSUER_URL.replace(/\/$/, ""),
    clientId: env.AUTH_DEVELOPER_CLIENT_ID,
    clientSecret: env.AUTH_DEVELOPER_CLIENT_SECRET,
    developerBaseUrl: env.DEVELOPER_BASE_URL,
  }
}

export function getDeveloperOAuthRedirectUri(config: DeveloperOAuthConfig) {
  return `${config.developerBaseUrl.replace(/\/$/, "")}/api/auth/callback`
}

export function buildDeveloperAuthorizeUrl({
  config,
  state,
  codeChallenge,
  prompt,
}: {
  config: DeveloperOAuthConfig
  state: string
  codeChallenge: string
  prompt?: "login" | "select_account"
}) {
  const url = new URL("/api/auth/oauth2/authorize", config.issuerUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", getDeveloperOAuthRedirectUri(config))
  url.searchParams.set("response_type", "code")
  url.searchParams.set(
    "scope",
    [
      "openid",
      "profile:read",
      "email:read",
      "membership:read",
      "developer:access",
    ].join(" "),
  )
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (prompt) url.searchParams.set("prompt", prompt)

  return url
}

export async function exchangeDeveloperAuthorizationCode({
  config,
  code,
  codeVerifier,
}: {
  config: DeveloperOAuthConfig
  code: string
  codeVerifier: string
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getDeveloperOAuthRedirectUri(config),
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
      signal: AbortSignal.timeout(tokenExchangeTimeoutMs),
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

export async function verifyDeveloperIdToken({
  config,
  idToken,
  accessToken,
  scope,
}: {
  config: DeveloperOAuthConfig
  idToken?: string
  accessToken: string
  scope?: string
}): Promise<VerifiedDeveloperToken> {
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

  if (!payload.sub || !scopes.includes("developer:access")) {
    throw new Error("Auth token is missing the Developer access grant.")
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    scopes,
    claims: payload,
  }
}
