import { createHash } from "node:crypto"
import { decodeProtectedHeader, jwtVerify } from "jose"
import { z } from "zod"
import { env } from "@/config/env"
import {
  assertSeoAssertionKeyringsDisjoint,
  resolveSeoAssertionKey,
  SeoAssertionConfigurationError,
  SeoAssertionInvalidError,
} from "./seo-assertion-keyring"

export const SEO_WORKLOAD_ASSERTION_HEADER = "x-forge-seo-assertion"
const SEO_WORKLOAD_ASSERTION_MAX_LIFETIME_SECONDS = 120

export const SeoWorkloadCapability = z.enum([
  "ingest",
  "evaluate",
  "tickets",
  "watch_alerts",
])
export type SeoWorkloadCapability = z.infer<typeof SeoWorkloadCapability>

const WorkloadClaims = z.object({
  environment: z.string().min(1),
  capability: SeoWorkloadCapability,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  jti: z.string().min(16).max(512),
  iat: z.number().int(),
  exp: z.number().int(),
})

export type VerifiedSeoWorkloadAssertion = {
  keyId: string
  environment: string
  audience: string
  capability: SeoWorkloadCapability
  requestDigest: string
  jtiHash: string
  expiresAt: Date
}

export function seoRequestDigest(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex")
}

export async function verifySeoWorkloadAssertion({
  assertion,
  capability,
  rawBody,
}: {
  assertion: string | null
  capability: SeoWorkloadCapability
  rawBody: string
}): Promise<VerifiedSeoWorkloadAssertion> {
  if (!assertion) throw new SeoAssertionInvalidError()
  if (
    env.NODE_ENV === "production" &&
    env.SEO_ASSERTION_ENVIRONMENT === "local"
  ) {
    throw new SeoAssertionConfigurationError()
  }
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(assertion)
  } catch {
    throw new SeoAssertionInvalidError()
  }
  if (
    header.alg !== "EdDSA" ||
    header.typ !== "seo-workload+jwt" ||
    !header.kid
  ) {
    throw new SeoAssertionInvalidError()
  }
  const audience = `forge-admin:seo:${capability}`
  assertSeoAssertionKeyringsDisjoint({
    approval: env.SEO_APPROVAL_PUBLIC_KEYS,
    workload: env.SEO_WORKLOAD_PUBLIC_KEYS,
  })
  const key = await resolveSeoAssertionKey({
    rawKeyring: env.SEO_WORKLOAD_PUBLIC_KEYS,
    kid: header.kid,
    keyringName: "workload",
  })
  let payload: unknown
  try {
    ;({ payload } = await jwtVerify(assertion, key, {
      algorithms: ["EdDSA"],
      issuer: "forge-mastra",
      audience,
      clockTolerance: 5,
    }))
  } catch {
    throw new SeoAssertionInvalidError()
  }
  const parsed = WorkloadClaims.safeParse(payload)
  const requestDigest = seoRequestDigest(rawBody)
  if (
    !parsed.success ||
    parsed.data.exp - parsed.data.iat >
      SEO_WORKLOAD_ASSERTION_MAX_LIFETIME_SECONDS ||
    parsed.data.iat > Math.floor(Date.now() / 1_000) + 5 ||
    parsed.data.environment !== env.SEO_ASSERTION_ENVIRONMENT ||
    parsed.data.capability !== capability ||
    parsed.data.requestDigest !== requestDigest
  ) {
    throw new SeoAssertionInvalidError()
  }
  return {
    keyId: header.kid,
    environment: parsed.data.environment,
    audience,
    capability,
    requestDigest,
    jtiHash: createHash("sha256").update(parsed.data.jti).digest("hex"),
    expiresAt: new Date(parsed.data.exp * 1000),
  }
}
