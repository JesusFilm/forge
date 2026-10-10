import { createHash } from "node:crypto"

import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose"
import { z } from "zod"

import { env } from "@/config/env"

export const MANAGER_REVIEWER_SESSION_PROOF_AUDIENCE =
  "forge-admin-subtitle-review-assertion"
const MAX_LIFETIME_SECONDS = 120

const Claims = z
  .object({
    v: z.literal(1),
    env: z.string().min(1),
    aud: z.union([z.string(), z.array(z.string())]),
    actorId: z.string().min(1).max(191),
    authSubject: z.string().min(1).max(191),
    assignmentId: z.string().min(1).max(191).optional(),
    operation: z.string().min(1).max(191).optional(),
    method: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE)$/),
    bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    nonce: z.string().min(16).max(512),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .refine(
    (claims) => Boolean(claims.assignmentId) !== Boolean(claims.operation),
  )

export class ManagerReviewerSessionProofInvalidError extends Error {
  constructor() {
    super("Invalid Manager reviewer session proof")
    this.name = "ManagerReviewerSessionProofInvalidError"
  }
}

export type VerifiedManagerReviewerSessionProof = {
  actorId: string
  authSubject: string
  assignmentId?: string
  operation?: string
  method: string
  bodyDigest: string
  nonceHash: string
  expiresAt: Date
}

/**
 * Verifies a proof minted by Manager's server after it has read and validated
 * the HttpOnly Manager session. The private key stays in Manager; Admin only
 * receives this short-lived, request-bound proof. The ordinary Manager
 * service credential therefore cannot impersonate a reviewer by itself.
 */
export async function verifyManagerReviewerSessionProof(
  proof: string,
): Promise<VerifiedManagerReviewerSessionProof> {
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(proof)
  } catch {
    throw new ManagerReviewerSessionProofInvalidError()
  }
  if (
    header.alg !== "EdDSA" ||
    header.typ !== "manager-reviewer-session+jwt" ||
    !header.kid
  ) {
    throw new ManagerReviewerSessionProofInvalidError()
  }

  const pem = parseKeyring(env.SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS)[header.kid]
  if (!pem) throw new ManagerReviewerSessionProofInvalidError()

  let payload: unknown
  try {
    const key = await importSPKI(pem, "EdDSA")
    ;({ payload } = await jwtVerify(proof, key, {
      algorithms: ["EdDSA"],
      issuer: "forge-manager",
      audience: MANAGER_REVIEWER_SESSION_PROOF_AUDIENCE,
      clockTolerance: 5,
    }))
  } catch {
    throw new ManagerReviewerSessionProofInvalidError()
  }

  const parsed = Claims.safeParse(payload)
  const now = Math.floor(Date.now() / 1_000)
  if (
    !parsed.success ||
    parsed.data.exp - parsed.data.iat > MAX_LIFETIME_SECONDS ||
    parsed.data.iat > now + 5 ||
    parsed.data.env !== env.SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT
  ) {
    throw new ManagerReviewerSessionProofInvalidError()
  }

  return {
    actorId: parsed.data.actorId,
    authSubject: parsed.data.authSubject,
    assignmentId: parsed.data.assignmentId,
    operation: parsed.data.operation,
    method: parsed.data.method,
    bodyDigest: parsed.data.bodyDigest,
    nonceHash: createHash("sha256").update(parsed.data.nonce).digest("hex"),
    expiresAt: new Date(parsed.data.exp * 1_000),
  }
}

function parseKeyring(raw: string | undefined): Record<string, string> {
  if (!raw) throw new ManagerReviewerSessionProofInvalidError()
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid keyring")
    }
    const entries = Object.entries(value)
    if (
      entries.length === 0 ||
      entries.some(
        ([kid, pem]) =>
          !kid.trim() || typeof pem !== "string" || !pem.includes("PUBLIC KEY"),
      )
    ) {
      throw new Error("invalid keyring")
    }
    return Object.fromEntries(entries) as Record<string, string>
  } catch {
    throw new ManagerReviewerSessionProofInvalidError()
  }
}
