import { generateKeyPair, exportPKCS8, jwtVerify } from "jose"
import { describe, expect, it } from "vitest"

import { getSeoConfig } from "../config/seo"
import {
  createSeoWorkloadAssertion,
  seoRequestDigest,
} from "./admin-seo-assertion"

describe("SEO workload assertions", () => {
  it("binds EdDSA identity, environment, capability, audience, and raw body digest", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    })
    const pem = await exportPKCS8(privateKey)
    const config = getSeoConfig({
      SEO_ASSERTION_ENVIRONMENT: "staging",
      SEO_WORKLOAD_KEY_ID: "seo-key-1",
      SEO_WORKLOAD_PRIVATE_KEY: pem,
    })
    const rawBody = '{"action":"claim_due","claimId":"claim-1"}'
    const token = await createSeoWorkloadAssertion({
      capability: "evaluate",
      rawBody,
      config,
      now: new Date("2026-08-01T12:00:00Z"),
      jti: "jti-1",
    })
    const verified = await jwtVerify(token, publicKey, {
      issuer: "forge-mastra",
      audience: "forge-admin:seo:evaluate",
      currentDate: new Date("2026-08-01T12:00:01Z"),
    })
    expect(verified.protectedHeader).toMatchObject({
      alg: "EdDSA",
      kid: "seo-key-1",
      typ: "seo-workload+jwt",
    })
    expect(verified.payload).toMatchObject({
      environment: "staging",
      capability: "evaluate",
      requestDigest: seoRequestDigest(rawBody),
      jti: "jti-1",
    })
  })
})
