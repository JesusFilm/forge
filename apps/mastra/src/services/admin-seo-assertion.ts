import { createHash, randomUUID } from "node:crypto"

import { importPKCS8, SignJWT } from "jose"

import { getSeoConfig, type SeoConfig } from "../config/seo"

export type SeoWorkloadCapability = "ingest" | "evaluate" | "tickets"

export function seoRequestDigest(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex")
}

export async function createSeoWorkloadAssertion(input: {
  capability: SeoWorkloadCapability
  rawBody: string
  config?: SeoConfig
  now?: Date
  jti?: string
}): Promise<string> {
  const config = input.config ?? getSeoConfig()
  const { keyId, privateKey, environment } = config.admin
  if (!keyId || !privateKey) {
    throw new Error("seo workload signing is not configured")
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000)
  const audience = `forge-admin:seo:${input.capability}`
  const key = await importPKCS8(privateKey, "EdDSA")
  return new SignJWT({
    environment,
    capability: input.capability,
    requestDigest: seoRequestDigest(input.rawBody),
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: keyId,
      typ: "seo-workload+jwt",
    })
    .setIssuer("forge-mastra")
    .setAudience(audience)
    .setJti(input.jti ?? randomUUID())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 60)
    .sign(key)
}
