import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto"
import { z } from "zod"

const ISSUER = "forge-tv-simulator"
const SCOPE = "tv-feedback:simulator"
const MAX_TOKEN_SECONDS = 7200
const FUTURE_CLOCK_SKEW_SECONDS = 60

const headerSchema = z
  .object({
    alg: z.literal("EdDSA"),
    typ: z.literal("JWT"),
    kid: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict()
const claimsSchema = z
  .object({
    iss: z.literal(ISSUER),
    aud: z.string(),
    scope: z.literal(SCOPE),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    jti: z.uuid(),
  })
  .strict()
export type SimulatorClaims = z.infer<typeof claimsSchema>
export type SignedSimulatorConfig = {
  audience: string
  keyId: string
  publicKey: KeyObject
}

export function signedSimulatorConfig(): SignedSimulatorConfig | null {
  if (process.env.FEEDBACK_SIMULATOR_SIGNED_ENABLED !== "true") return null
  try {
    const audience = process.env.FEEDBACK_SIMULATOR_AUDIENCE ?? ""
    const parsed = new URL(audience)
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== audience ||
      parsed.username ||
      parsed.password ||
      new URL(process.env.FEEDBACK_BASE_URL ?? "").origin !== audience
    )
      return null
    const pem = process.env.FEEDBACK_SIMULATOR_PUBLIC_KEY ?? ""
    if (
      pem.length > 2048 ||
      !pem.trim().startsWith("-----BEGIN PUBLIC KEY-----")
    )
      return null
    const publicKey = createPublicKey(pem)
    if (publicKey.asymmetricKeyType !== "ed25519") return null
    const der = publicKey.export({ type: "spki", format: "der" })
    const keyId = createHash("sha256").update(der).digest("hex").slice(0, 16)
    return { audience, publicKey, keyId }
  } catch {
    return null
  }
}

export class SimulatorTokenError extends Error {
  constructor() {
    super("invalid_or_expired_simulator_token")
  }
}

function decode(segment: string): Buffer {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment))
    throw new SimulatorTokenError()
  const bytes = Buffer.from(segment, "base64url")
  if (bytes.toString("base64url") !== segment) throw new SimulatorTokenError()
  return bytes
}

export function verifySimulatorToken(
  token: string,
  config: SignedSimulatorConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): SimulatorClaims {
  try {
    if (token.length > 4096) throw new SimulatorTokenError()
    const segments = token.split(".")
    if (segments.length !== 3) throw new SimulatorTokenError()
    const [encodedHeader, encodedPayload, encodedSignature] = segments
    const header = headerSchema.parse(
      JSON.parse(decode(encodedHeader).toString("utf8")),
    )
    if (
      header.kid !== config.keyId ||
      config.publicKey.asymmetricKeyType !== "ed25519"
    )
      throw new SimulatorTokenError()
    const signature = decode(encodedSignature)
    if (
      signature.length !== 64 ||
      !verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        config.publicKey,
        signature,
      )
    )
      throw new SimulatorTokenError()
    const claims = claimsSchema.parse(
      JSON.parse(decode(encodedPayload).toString("utf8")),
    )
    if (
      claims.aud !== config.audience ||
      claims.iat > nowSeconds + FUTURE_CLOCK_SKEW_SECONDS ||
      claims.exp <= nowSeconds ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > MAX_TOKEN_SECONDS
    )
      throw new SimulatorTokenError()
    return claims
  } catch {
    throw new SimulatorTokenError()
  }
}

export function signedSimulatorSessionAllowed(session: {
  source?: "signed-simulator"
  signingKeyId?: string
}): boolean {
  if (session.source !== "signed-simulator") return true
  const config = signedSimulatorConfig()
  return config !== null && session.signingKeyId === config.keyId
}
