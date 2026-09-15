import { createHash, randomUUID } from "node:crypto"
import { jwtVerify, SignJWT } from "jose"
import { z } from "zod"

import { env } from "@/config/env"

export const SUBTITLE_REVIEW_ASSERTION_AUDIENCE = "forge-admin-subtitle-review"
const SUBTITLE_REVIEW_ASSERTION_MAX_LIFETIME_SECONDS = 120

const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Claims = z.object({
  v: z.literal(1),
  aud: z.union([z.string(), z.array(z.string())]),
  actorId: z.string().min(1).max(191),
  assignmentId: z.string().min(1).max(191),
  method: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE)$/),
  bodyDigest: Digest,
  requestId: z.string().min(1).max(191),
  nonce: z.string().min(16).max(191),
  iat: z.number().int(),
  exp: z.number().int(),
})

export class SubtitleReviewAssertionInvalidError extends Error {
  constructor() {
    super("Invalid subtitle review assertion")
    this.name = "SubtitleReviewAssertionInvalidError"
  }
}

export type VerifiedSubtitleReviewAssertion = {
  actorId: string
  assignmentId: string
  method: string
  bodyDigest: string
  requestId: string
  nonceHash: string
  expiresAt: Date
}

export async function mintSubtitleReviewAssertion(input: {
  actorId: string
  assignmentId: string
  method: string
  bodyDigest: string
  requestId: string
  lifetimeSeconds?: number
}): Promise<string> {
  const method = input.method.toUpperCase()
  const bodyDigest = Digest.parse(input.bodyDigest)
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) {
    throw new SubtitleReviewAssertionInvalidError()
  }
  const lifetimeSeconds = Math.min(
    SUBTITLE_REVIEW_ASSERTION_MAX_LIFETIME_SECONDS,
    Math.max(15, input.lifetimeSeconds ?? 90),
  )
  const now = Math.floor(Date.now() / 1_000)

  return new SignJWT({
    v: 1,
    actorId: input.actorId,
    assignmentId: input.assignmentId,
    method,
    bodyDigest,
    requestId: input.requestId,
    nonce: randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256", typ: "subtitle-review+jwt" })
    .setIssuer("forge-admin")
    .setAudience(SUBTITLE_REVIEW_ASSERTION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(signingKey())
}

export async function verifySubtitleReviewAssertion(
  assertion: string,
): Promise<VerifiedSubtitleReviewAssertion> {
  let payload: unknown
  try {
    const verified = await jwtVerify(assertion, signingKey(), {
      algorithms: ["HS256"],
      issuer: "forge-admin",
      audience: SUBTITLE_REVIEW_ASSERTION_AUDIENCE,
      clockTolerance: 5,
    })
    if (verified.protectedHeader.typ !== "subtitle-review+jwt") {
      throw new Error("wrong assertion type")
    }
    payload = verified.payload
  } catch {
    throw new SubtitleReviewAssertionInvalidError()
  }

  const parsed = Claims.safeParse(payload)
  const now = Math.floor(Date.now() / 1_000)
  if (
    !parsed.success ||
    parsed.data.exp - parsed.data.iat >
      SUBTITLE_REVIEW_ASSERTION_MAX_LIFETIME_SECONDS ||
    parsed.data.iat > now + 5
  ) {
    throw new SubtitleReviewAssertionInvalidError()
  }

  return {
    actorId: parsed.data.actorId,
    assignmentId: parsed.data.assignmentId,
    method: parsed.data.method,
    bodyDigest: parsed.data.bodyDigest,
    requestId: parsed.data.requestId,
    nonceHash: createHash("sha256").update(parsed.data.nonce).digest("hex"),
    expiresAt: new Date(parsed.data.exp * 1_000),
  }
}

function signingKey() {
  return new TextEncoder().encode(env.ADMIN_SESSION_SECRET)
}
