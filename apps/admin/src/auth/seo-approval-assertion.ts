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

export const SEO_APPROVAL_AUDIENCE = "forge-admin-seo-approval"
const SEO_APPROVAL_ASSERTION_MAX_LIFETIME_SECONDS = 120

export const SeoApprovalAction = z.enum([
  "approve",
  "reject",
  "review_lesson",
  "reconcile_ticket",
])
export type SeoApprovalAction = z.infer<typeof SeoApprovalAction>

const SeoApprovalClaims = z.object({
  v: z.literal(1),
  env: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  actorId: z.string().min(1).max(191),
  action: SeoApprovalAction,
  proposalId: z.string().min(1).max(191),
  version: z.number().int().positive(),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.string().min(16).max(512),
  iat: z.number().int(),
  exp: z.number().int(),
})

export type VerifiedSeoApprovalAssertion = {
  keyId: string
  environment: string
  audience: typeof SEO_APPROVAL_AUDIENCE
  actorId: string
  action: SeoApprovalAction
  proposalId: string
  version: number
  payloadDigest: string
  nonceHash: string
  expiresAt: Date
}

export async function verifySeoApprovalAssertion(
  assertion: string,
): Promise<VerifiedSeoApprovalAssertion> {
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
    header.typ !== "seo-approval+jwt" ||
    !header.kid
  ) {
    throw new SeoAssertionInvalidError()
  }
  assertSeoAssertionKeyringsDisjoint({
    approval: env.SEO_APPROVAL_PUBLIC_KEYS,
    workload: env.SEO_WORKLOAD_PUBLIC_KEYS,
  })
  const key = await resolveSeoAssertionKey({
    rawKeyring: env.SEO_APPROVAL_PUBLIC_KEYS,
    kid: header.kid,
    keyringName: "approval",
  })
  let payload: unknown
  try {
    ;({ payload } = await jwtVerify(assertion, key, {
      algorithms: ["EdDSA"],
      issuer: "forge-manager",
      audience: SEO_APPROVAL_AUDIENCE,
      clockTolerance: 5,
    }))
  } catch {
    throw new SeoAssertionInvalidError()
  }
  const parsed = SeoApprovalClaims.safeParse(payload)
  if (
    !parsed.success ||
    parsed.data.exp - parsed.data.iat >
      SEO_APPROVAL_ASSERTION_MAX_LIFETIME_SECONDS ||
    parsed.data.iat > Math.floor(Date.now() / 1_000) + 5 ||
    parsed.data.env !== env.SEO_ASSERTION_ENVIRONMENT
  ) {
    throw new SeoAssertionInvalidError()
  }
  return {
    keyId: header.kid,
    environment: parsed.data.env,
    audience: SEO_APPROVAL_AUDIENCE,
    actorId: parsed.data.actorId,
    action: parsed.data.action,
    proposalId: parsed.data.proposalId,
    version: parsed.data.version,
    payloadDigest: parsed.data.payloadDigest,
    nonceHash: createHash("sha256").update(parsed.data.nonce).digest("hex"),
    expiresAt: new Date(parsed.data.exp * 1000),
  }
}
