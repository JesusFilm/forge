import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { env, getAuthIssuerUrl, getGatewayBaseUrl } from "@/config/env"

const tokenExchangeTimeoutMs = 10_000

export type MastraStudioOAuthConfig = {
  issuerUrl: string
  clientId: string
  clientSecret?: string
  gatewayBaseUrl: string
}

export type VerifiedMastraStudioToken = {
  subject: string
  email?: string
  name?: string
  scopes: string[]
  claims: JWTPayload
}

export function getMastraStudioOAuthConfig(): MastraStudioOAuthConfig {
  if (!env.AUTH_MASTRA_STUDIO_CLIENT_ID) {
    throw new Error(
      "AUTH_MASTRA_STUDIO_CLIENT_ID is required for Mastra Studio OAuth",
    )
  }

  return {
    issuerUrl: getAuthIssuerUrl(),
    clientId: env.AUTH_MASTRA_STUDIO_CLIENT_ID,
    clientSecret: env.AUTH_MASTRA_STUDIO_CLIENT_SECRET,
    gatewayBaseUrl: getGatewayBaseUrl(),
  }
}

export function getMastraStudioOAuthRedirectUri(
  config: MastraStudioOAuthConfig,
) {
  return `${config.gatewayBaseUrl.replace(/\/$/, "")}/api/auth/callback`
}

export function buildMastraStudioAuthorizeUrl({
  config,
  state,
  codeChallenge,
  prompt,
}: {
  config: MastraStudioOAuthConfig
  state: string
  codeChallenge: string
  prompt?: "login" | "select_account"
}) {
  const url = new URL("/api/auth/oauth2/authorize", config.issuerUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", getMastraStudioOAuthRedirectUri(config))
  url.searchParams.set("response_type", "code")
  url.searchParams.set(
    "scope",
    ["openid", "profile:read", "email:read", "mastra-studio:access"].join(" "),
  )
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (prompt) url.searchParams.set("prompt", prompt)

  return url
}

export async function exchangeMastraStudioAuthorizationCode({
  config,
  code,
  codeVerifier,
}: {
  config: MastraStudioOAuthConfig
  code: string
  codeVerifier: string
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getMastraStudioOAuthRedirectUri(config),
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

export async function verifyMastraStudioIdToken({
  config,
  idToken,
  accessToken,
  scope,
}: {
  config: MastraStudioOAuthConfig
  idToken?: string
  accessToken: string
  scope?: string
}): Promise<VerifiedMastraStudioToken> {
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

  if (!payload.sub || !scopes.includes("mastra-studio:access")) {
    throw new Error("Auth token is missing the Mastra Studio access grant.")
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    scopes,
    claims: payload,
  }
}
