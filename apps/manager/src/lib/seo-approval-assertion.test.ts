import { exportPKCS8, generateKeyPair, jwtVerify } from "jose"
import { describe, expect, it } from "vitest"
import { createSeoApprovalAssertion } from "./seo-approval-assertion"

describe("createSeoApprovalAssertion", () => {
  it("binds a short-lived Ed25519 assertion to the exact actor, action, proposal, digest, and environment", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    })
    const privateKeyPem = await exportPKCS8(privateKey)
    const token = await createSeoApprovalAssertion(
      {
        actorId: "manager-user-7",
        action: "approve",
        proposalId: "proposal-1",
        version: 3,
        payloadDigest: "sha256:payload-v3",
      },
      {
        environment: "staging",
        keyId: "seo-staging-2026-08",
        privateKey: privateKeyPem,
        now: new Date("2026-08-01T12:00:00.000Z"),
        nonce: "nonce-fixed-for-test",
      },
    )

    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
      audience: "forge-admin-seo-approval",
      currentDate: new Date("2026-08-01T12:00:30.000Z"),
    })
    expect(protectedHeader).toMatchObject({
      alg: "EdDSA",
      kid: "seo-staging-2026-08",
    })
    expect(payload).toMatchObject({
      v: 1,
      env: "staging",
      actorId: "manager-user-7",
      action: "approve",
      proposalId: "proposal-1",
      version: 3,
      payloadDigest: "sha256:payload-v3",
      nonce: "nonce-fixed-for-test",
    })
    expect((payload.exp as number) - (payload.iat as number)).toBe(60)
  })

  it("uses separate action values for lesson review and ticket reconciliation", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    })
    const privateKeyPem = await exportPKCS8(privateKey)
    const token = await createSeoApprovalAssertion(
      {
        actorId: "manager-user-7",
        action: "review_lesson",
        proposalId: "proposal-1",
        version: 1,
        payloadDigest: "sha256:payload",
      },
      {
        environment: "local",
        keyId: "seo-local",
        privateKey: privateKeyPem,
      },
    )
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["EdDSA"],
      audience: "forge-admin-seo-approval",
    })
    expect(payload.action).toBe("review_lesson")
  })
})
