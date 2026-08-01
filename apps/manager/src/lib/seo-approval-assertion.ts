import { randomUUID } from "node:crypto"
import { importPKCS8, SignJWT } from "jose"
import { env } from "@/config/env"

const SEO_ASSERTION_AUDIENCE = "forge-admin-seo-approval"
const SEO_ASSERTION_LIFETIME_SECONDS = 60

export type SeoApprovalAction =
  | "approve"
  | "reject"
  | "review_lesson"
  | "reconcile_ticket"

export type SeoApprovalAssertionInput = {
  actorId: string
  action: SeoApprovalAction
  proposalId: string
  version: number
  payloadDigest: string
}

export type SeoApprovalAssertionConfig = {
  environment: "local" | "preview" | "staging" | "production"
  keyId: string
  privateKey: string
  now?: Date
  nonce?: string
}

export class SeoApprovalAssertionConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeoApprovalAssertionConfigurationError"
  }
}

function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value
}

function configuredAssertion(): SeoApprovalAssertionConfig {
  if (
    env.NODE_ENV === "production" &&
    env.SEO_ASSERTION_ENVIRONMENT === "local"
  ) {
    throw new SeoApprovalAssertionConfigurationError(
      "SEO_ASSERTION_ENVIRONMENT must be explicit outside local development.",
    )
  }
  if (!env.SEO_APPROVAL_PRIVATE_KEY || !env.SEO_APPROVAL_KEY_ID) {
    throw new SeoApprovalAssertionConfigurationError(
      "SEO delegated approval signing is not configured.",
    )
  }

  return {
    environment: env.SEO_ASSERTION_ENVIRONMENT,
    keyId: env.SEO_APPROVAL_KEY_ID,
    privateKey: normalizePrivateKey(env.SEO_APPROVAL_PRIVATE_KEY),
  }
}

export async function createSeoApprovalAssertion(
  input: SeoApprovalAssertionInput,
  config: SeoApprovalAssertionConfig = configuredAssertion(),
): Promise<string> {
  const nowSeconds = Math.floor((config.now ?? new Date()).getTime() / 1000)
  const privateKey = await importPKCS8(
    normalizePrivateKey(config.privateKey),
    "EdDSA",
  )

  return new SignJWT({
    v: 1,
    env: config.environment,
    actorId: input.actorId,
    action: input.action,
    proposalId: input.proposalId,
    version: input.version,
    payloadDigest: input.payloadDigest,
    nonce: config.nonce ?? randomUUID(),
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: config.keyId,
      typ: "seo-approval+jwt",
    })
    .setIssuer("forge-manager")
    .setAudience(SEO_ASSERTION_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SEO_ASSERTION_LIFETIME_SECONDS)
    .sign(privateKey)
}
