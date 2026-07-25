import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import {
  getDefaultWatchCallbackOrigins,
  normalizeOrigin,
} from "@forge/watch-url-policy/callbacks"

import { env } from "@/env"

const WEB_AUTH_SCOPES = [
  "openid",
  "profile:read",
  "email:read",
  "web:watch-events:write",
] as const

export type WebOAuthConfig = {
  issuerUrl: string
  clientId: string
  webBaseUrl: string
}

export type WebTokenResponse = {
  access_token: string
  id_token?: string
  scope?: string
  expires_in?: number
}

export type VerifiedWebIdToken = {
  subject: string
  email?: string
  name?: string
  image?: string
  scopes: string[]
  claims: JWTPayload
}

export function getWebOAuthConfig(options?: {
  requestOrigin?: string
}): WebOAuthConfig | null {
  const issuerUrl = (
    env.WEB_AUTH_ISSUER_URL ?? new URL("/api/auth", env.WEB_AUTH_BASE_URL).href
  ).replace(/\/$/, "")
  const clientId = env.WEB_AUTH_CLIENT_ID ?? defaultClientId()
  const webBaseUrl = resolveWebBaseUrl({
    configuredBaseUrl: env.WEB_BASE_URL,
    clientId,
    requestOrigin: options?.requestOrigin,
  })

  if (!issuerUrl || !clientId || !webBaseUrl) return null

  return {
    issuerUrl,
    clientId,
    webBaseUrl,
  }
}

export function getWebOAuthRedirectUri(config: WebOAuthConfig) {
  return `${config.webBaseUrl}/watch/api/auth/callback`
}

export function buildWebAuthorizeUrl({
  config,
  state,
  codeChallenge,
  prompt,
}: {
  config: WebOAuthConfig
  state: string
  codeChallenge: string
  prompt?: "login" | "select_account"
}) {
  const url = new URL("/api/auth/oauth2/authorize", config.issuerUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", getWebOAuthRedirectUri(config))
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", WEB_AUTH_SCOPES.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (prompt) {
    url.searchParams.set("prompt", prompt)
  }

  return url
}

export async function exchangeWebAuthorizationCode({
  config,
  code,
  codeVerifier,
}: {
  config: WebOAuthConfig
  code: string
  codeVerifier: string
}): Promise<WebTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getWebOAuthRedirectUri(config),
    client_id: config.clientId,
    code_verifier: codeVerifier,
  })

  const response = await fetch(
    new URL("/api/auth/oauth2/token", config.issuerUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    },
  )

  if (!response.ok) {
    throw new Error("Auth code exchange failed.")
  }

  return response.json() as Promise<WebTokenResponse>
}

export async function verifyWebIdToken({
  config,
  idToken,
  scope,
}: {
  config: WebOAuthConfig
  idToken?: string
  scope?: string
}): Promise<VerifiedWebIdToken> {
  if (!idToken) {
    throw new Error("Auth response is missing an id_token.")
  }

  const jwks = createRemoteJWKSet(new URL("/api/auth/jwks", config.issuerUrl))
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: config.issuerUrl,
    audience: config.clientId,
    algorithms: ["EdDSA", "RS256", "ES256"],
  })
  const scopes = (scope ?? payload.scope ?? "")
    .toString()
    .split(" ")
    .filter(Boolean)

  if (!payload.sub) {
    throw new Error("Auth id_token is missing a subject.")
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    image: typeof payload.picture === "string" ? payload.picture : undefined,
    scopes,
    claims: payload,
  }
}

function defaultClientId() {
  switch (process.env.NODE_ENV) {
    case "production":
      return "jfp_web_production"
    case "test":
      return "jfp_web_local"
    default:
      return "jfp_web_local"
  }
}

function resolveWebBaseUrl({
  configuredBaseUrl,
  clientId,
  requestOrigin,
}: {
  configuredBaseUrl: string
  clientId: string
  requestOrigin?: string
}) {
  if (
    clientId === "jfp_web_local" &&
    requestOrigin &&
    isLoopbackOrigin(requestOrigin)
  ) {
    return requestOrigin.replace(/\/$/, "")
  }

  if (requestOrigin && isAllowedWatchRequestOrigin(requestOrigin)) {
    return requestOrigin.replace(/\/$/, "")
  }

  return configuredBaseUrl.replace(/\/$/, "")
}

function isAllowedWatchRequestOrigin(value: string) {
  const origin = normalizeOrigin(value)
  if (!origin) return false

  return getDefaultWatchCallbackOrigins(process.env.NODE_ENV).includes(origin)
}

function isLoopbackOrigin(value: string | undefined) {
  if (!value) return false

  try {
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    )
  } catch {
    return false
  }
}
