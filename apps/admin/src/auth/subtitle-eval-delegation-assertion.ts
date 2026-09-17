import { createHash, randomUUID } from "node:crypto"

import { jwtVerify, SignJWT } from "jose"
import { z } from "zod"

import { env } from "@/config/env"

export const SUBTITLE_EVAL_DELEGATION_AUDIENCE =
  "forge-admin-subtitle-eval-delegation"
const MAX_LIFETIME_SECONDS = 120

export const SubtitleEvalDelegatedOperation = z.enum([
  "IMPORT_CORPUS",
  "APPROVE_CORPUS",
  "CREATE_RUN",
  "CREATE_ASSIGNMENT",
  "ASSIGN_SPECIALIST",
  "DISPOSITION_REFERENCE_ISSUE",
  "CREATE_COMPARISON",
  "APPEND_NARRATIVE",
  "RECOVER_RUN",
  "REVIEWER_QUEUE",
])

const Claims = z.object({
  v: z.literal(1),
  aud: z.union([z.string(), z.array(z.string())]),
  env: z.string().min(1),
  actorId: z.string().min(1).max(191),
  managerRole: z.enum(["OPERATOR", "REVIEWER"]),
  operation: SubtitleEvalDelegatedOperation,
  method: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE)$/),
  bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().min(1).max(191),
  nonce: z.string().min(16).max(191),
  iat: z.number().int(),
  exp: z.number().int(),
})

export type VerifiedSubtitleEvalDelegation = {
  actorId: string
  managerRole: "OPERATOR" | "REVIEWER"
  operation: z.infer<typeof SubtitleEvalDelegatedOperation>
  method: string
  bodyDigest: string
  requestId: string
  nonceHash: string
  expiresAt: Date
}

export class SubtitleEvalDelegationInvalidError extends Error {
  constructor() {
    super("Invalid subtitle evaluation delegation")
    this.name = "SubtitleEvalDelegationInvalidError"
  }
}

export function subtitleEvalDelegationBodyDigest(input: unknown) {
  return createHash("sha256").update(stableJson(input)).digest("hex")
}

export async function mintSubtitleEvalDelegation(input: {
  actorId: string
  managerRole: "OPERATOR" | "REVIEWER"
  operation: z.infer<typeof SubtitleEvalDelegatedOperation>
  method: string
  bodyDigest: string
  requestId: string
  lifetimeSeconds?: number
}) {
  const method = input.method.toUpperCase()
  const operation = SubtitleEvalDelegatedOperation.parse(input.operation)
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) {
    throw new SubtitleEvalDelegationInvalidError()
  }
  if (!/^[a-f0-9]{64}$/.test(input.bodyDigest)) {
    throw new SubtitleEvalDelegationInvalidError()
  }
  const now = Math.floor(Date.now() / 1_000)
  const lifetime = Math.min(
    MAX_LIFETIME_SECONDS,
    Math.max(15, input.lifetimeSeconds ?? 90),
  )
  return new SignJWT({
    v: 1,
    env: env.SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT,
    actorId: input.actorId,
    managerRole: input.managerRole,
    operation,
    method,
    bodyDigest: input.bodyDigest,
    requestId: input.requestId,
    nonce: randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256", typ: "subtitle-eval-delegation+jwt" })
    .setIssuer("forge-admin")
    .setAudience(SUBTITLE_EVAL_DELEGATION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(signingKey())
}

export async function verifySubtitleEvalDelegation(
  assertion: string,
): Promise<VerifiedSubtitleEvalDelegation> {
  let payload: unknown
  try {
    const verified = await jwtVerify(assertion, signingKey(), {
      algorithms: ["HS256"],
      issuer: "forge-admin",
      audience: SUBTITLE_EVAL_DELEGATION_AUDIENCE,
      clockTolerance: 5,
    })
    if (verified.protectedHeader.typ !== "subtitle-eval-delegation+jwt") {
      throw new Error("wrong assertion type")
    }
    payload = verified.payload
  } catch {
    throw new SubtitleEvalDelegationInvalidError()
  }
  const parsed = Claims.safeParse(payload)
  const now = Math.floor(Date.now() / 1_000)
  if (
    !parsed.success ||
    parsed.data.env !== env.SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT ||
    parsed.data.exp - parsed.data.iat > MAX_LIFETIME_SECONDS ||
    parsed.data.iat > now + 5
  ) {
    throw new SubtitleEvalDelegationInvalidError()
  }
  return {
    actorId: parsed.data.actorId,
    managerRole: parsed.data.managerRole,
    operation: parsed.data.operation,
    method: parsed.data.method,
    bodyDigest: parsed.data.bodyDigest,
    requestId: parsed.data.requestId,
    nonceHash: createHash("sha256").update(parsed.data.nonce).digest("hex"),
    expiresAt: new Date(parsed.data.exp * 1_000),
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString())
  return JSON.stringify(value)
}

function signingKey() {
  return new TextEncoder().encode(env.ADMIN_SESSION_SECRET)
}
