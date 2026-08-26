import { randomUUID } from "node:crypto"

import { importPKCS8, SignJWT } from "jose"

import { env } from "@/config/env"

const AUDIENCE = "forge-admin-subtitle-review-assertion"
const LIFETIME_SECONDS = 90

export type SubtitleEvalSessionProofInput = {
  actorId: string
  authSubject: string
  assignmentId?: string
  operation?: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  bodyDigest: string
}

export type SubtitleEvalSessionProofConfig = {
  environment: string
  keyId: string
  privateKey: string
  now?: Date
  nonce?: string
}

export class SubtitleEvalSessionProofConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubtitleEvalSessionProofConfigurationError"
  }
}

export async function createSubtitleEvalSessionProof(
  input: SubtitleEvalSessionProofInput,
  config: SubtitleEvalSessionProofConfig = configuredProof(),
) {
  if (Boolean(input.assignmentId) === Boolean(input.operation)) {
    throw new SubtitleEvalSessionProofConfigurationError(
      "Exactly one assignment or operation binding is required.",
    )
  }
  if (!/^[a-f0-9]{64}$/.test(input.bodyDigest)) {
    throw new SubtitleEvalSessionProofConfigurationError(
      "A canonical SHA-256 body digest is required.",
    )
  }
  const now = Math.floor((config.now ?? new Date()).getTime() / 1_000)
  const key = await importPKCS8(normalizeKey(config.privateKey), "EdDSA")
  return new SignJWT({
    v: 1,
    env: config.environment,
    actorId: input.actorId,
    authSubject: input.authSubject,
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    method: input.method,
    bodyDigest: input.bodyDigest,
    nonce: config.nonce ?? randomUUID(),
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: config.keyId,
      typ: "manager-reviewer-session+jwt",
    })
    .setIssuer("forge-manager")
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + LIFETIME_SECONDS)
    .sign(key)
}

function configuredProof(): SubtitleEvalSessionProofConfig {
  if (
    !env.SUBTITLE_REVIEW_SESSION_KEY_ID ||
    !env.SUBTITLE_REVIEW_SESSION_PRIVATE_KEY
  ) {
    throw new SubtitleEvalSessionProofConfigurationError(
      "Subtitle evaluation session proof signing is not configured.",
    )
  }
  return {
    environment: env.SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT,
    keyId: env.SUBTITLE_REVIEW_SESSION_KEY_ID,
    privateKey: env.SUBTITLE_REVIEW_SESSION_PRIVATE_KEY,
  }
}

function normalizeKey(value: string) {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value
}
