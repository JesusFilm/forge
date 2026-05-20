import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { env } from "@/config/env"

export type ManagerOAuthConfig = {
  issuerUrl: string
  clientId: string
  clientSecret?: string
  managerBaseUrl: string
}

export type VerifiedManagerToken = {
  subject: string
  email?: string
  name?: string
  scopes: string[]
  claims: JWTPayload
}

export function getManagerOAuthConfig(): ManagerOAuthConfig {
  if (!env.AUTH_ISSUER_URL) {
    throw new Error("AUTH_ISSUER_URL is required for Manager OAuth")
  }
  if (!env.AUTH_MANAGER_CLIENT_ID) {
    throw new Error("AUTH_MANAGER_CLIENT_ID is required for Manager OAuth")
  }

  return {
    issuerUrl: env.AUTH_ISSUER_URL.replace(/\/$/, ""),
    clientId: env.AUTH_MANAGER_CLIENT_ID,
    clientSecret: env.AUTH_MANAGER_CLIENT_SECRET,
    managerBaseUrl: env.MANAGER_BASE_URL ?? "http://localhost:3002",
  }
}

export function getManagerOAuthRedirectUri(config: ManagerOAuthConfig) {
  return `${config.managerBaseUrl.replace(/\/$/, "")}/api/auth/callback`
}

export function buildManagerAuthorizeUrl({
  config,
  state,
  codeChallenge,
  prompt,
}: {
  config: ManagerOAuthConfig
  state: string
  codeChallenge: string
  prompt?: "login" | "select_account"
}) {
  const url = new URL("/api/auth/oauth2/authorize", config.issuerUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", getManagerOAuthRedirectUri(config))
  url.searchParams.set("response_type", "code")
  url.searchParams.set(
    "scope",
    ["openid", "profile:read", "email:read", "manager:access"].join(" "),
  )
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (prompt) {
    url.searchParams.set("prompt", prompt)
  }

  return url
}

export async function exchangeManagerAuthorizationCode({
  config,
  code,
  codeVerifier,
}: {
  config: ManagerOAuthConfig
  code: string
  codeVerifier: string
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getManagerOAuthRedirectUri(config),
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

export async function verifyManagerIdToken({
  config,
  idToken,
  accessToken,
  scope,
}: {
  config: ManagerOAuthConfig
  idToken?: string
  accessToken: string
  scope?: string
}): Promise<VerifiedManagerToken> {
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

  if (!payload.sub || !scopes.includes("manager:access")) {
    throw new Error("Auth token is missing the Manager access grant.")
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    scopes,
    claims: payload,
  }
}
