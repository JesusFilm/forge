import { SignJWT, jwtVerify } from "jose"

export const RECOMMENDATION_TESTER_COOKIE = "forge_recommendation_tester"
export const RECOMMENDATION_TESTER_CONTEXT_KIND = "watch-recommendation-tester"
export const RECOMMENDATION_TESTER_PATH = "/watch/api/recommendations/tester"
export const RECOMMENDATION_TESTER_COOKIE_PATH = "/watch/api/recommendations"
export const TESTER_ACTIVATION_SECONDS = 24 * 60 * 60
export const TESTER_SESSION_SECONDS = 7 * TESTER_ACTIVATION_SECONDS

const SCOPE = "forge.watch.homepageRecommendations"
const TOKEN_TYPE = "watch-recommendation-tester+jwt"
const MAX_TOKEN_LENGTH = 1024
const TESTER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type TokenPurpose = "activation" | "session"
export type RecommendationTesterConfig = { secret?: string; origin: string }

export class RecommendationTesterConfigurationError extends Error {
  constructor() {
    super(
      "Recommendation tester access requires a strong secret and a valid origin",
    )
    this.name = "RecommendationTesterConfigurationError"
  }
}

function configuration(config: RecommendationTesterConfig) {
  if (!config.secret || config.secret.length < 32) return null
  try {
    const url = new URL(config.origin)
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null
    return { issuer: url.origin, key: new TextEncoder().encode(config.secret) }
  } catch {
    return null
  }
}

async function sign(
  config: RecommendationTesterConfig,
  testerId: string,
  purpose: TokenPurpose,
  issuedAt: number,
  expiresAt: number,
) {
  const resolved = configuration(config)
  if (!resolved || !TESTER_ID.test(testerId)) {
    throw new RecommendationTesterConfigurationError()
  }
  return new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "HS256", typ: TOKEN_TYPE })
    .setIssuer(resolved.issuer)
    .setAudience(`${RECOMMENDATION_TESTER_CONTEXT_KIND}:${purpose}`)
    .setSubject(testerId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(resolved.key)
}

async function verify(
  token: string | undefined,
  config: RecommendationTesterConfig,
  purpose: TokenPurpose,
) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  const resolved = configuration(config)
  if (!resolved) return null
  try {
    const { payload } = await jwtVerify(token, resolved.key, {
      algorithms: ["HS256"],
      typ: TOKEN_TYPE,
      issuer: resolved.issuer,
      audience: `${RECOMMENDATION_TESTER_CONTEXT_KIND}:${purpose}`,
      requiredClaims: ["sub", "iat", "exp"],
    })
    const now = Math.floor(Date.now() / 1000)
    const lifetime =
      purpose === "activation"
        ? TESTER_ACTIVATION_SECONDS
        : TESTER_SESSION_SECONDS
    if (
      typeof payload.sub !== "string" ||
      !TESTER_ID.test(payload.sub) ||
      payload.scope !== SCOPE ||
      typeof payload.iat !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > lifetime
    )
      return null
    return { testerId: payload.sub, issuedAt: payload.iat }
  } catch {
    return null
  }
}

/** Operator-only issuer. Never expose a signing/issuance endpoint. */
export async function createRecommendationTesterLink(
  config: RecommendationTesterConfig,
  testerId: string,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = await sign(
    config,
    testerId,
    "activation",
    issuedAt,
    issuedAt + TESTER_ACTIVATION_SECONDS,
  )
  const url = new URL(RECOMMENDATION_TESTER_PATH, config.origin)
  // Fragments do not enter HTTP request URLs, referrers, or server access logs.
  url.hash = token
  return url.href
}

export async function exchangeRecommendationTesterLink(
  token: string,
  config: RecommendationTesterConfig,
): Promise<{ cookie: string; maxAge: number } | null> {
  const activation = await verify(token, config, "activation")
  if (!activation) return null
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = activation.issuedAt + TESTER_SESSION_SECONDS
  return {
    cookie: await sign(config, activation.testerId, "session", now, expiresAt),
    maxAge: expiresAt - now,
  }
}

export async function readRecommendationTesterCookie(
  value: string | undefined,
  config: RecommendationTesterConfig,
): Promise<string | null> {
  return (await verify(value, config, "session"))?.testerId ?? null
}
