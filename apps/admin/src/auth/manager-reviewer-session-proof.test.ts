import { exportSPKI, generateKeyPair, SignJWT } from "jose"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT: "test",
    SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS: "",
  },
}))

vi.mock("@/config/env", () => mockEnv)

describe("verifyManagerReviewerSessionProof", () => {
  beforeEach(() => {
    mockEnv.env.SUBTITLE_REVIEW_ASSERTION_ENVIRONMENT = "test"
    mockEnv.env.SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS = ""
  })

  it("verifies a short-lived Manager-server proof bound to the exact reviewer request", async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true })
    mockEnv.env.SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS = JSON.stringify({
      "manager-test": await exportSPKI(pair.publicKey),
    })
    const now = Math.floor(Date.now() / 1_000)
    const proof = await new SignJWT({
      v: 1,
      env: "test",
      actorId: "admin-user-1",
      authSubject: "auth-user-1",
      assignmentId: "assignment-1",
      method: "POST",
      bodyDigest: "a".repeat(64),
      nonce: "manager-session-proof-nonce-1",
    })
      .setProtectedHeader({
        alg: "EdDSA",
        kid: "manager-test",
        typ: "manager-reviewer-session+jwt",
      })
      .setIssuer("forge-manager")
      .setAudience("forge-admin-subtitle-review-assertion")
      .setIssuedAt(now)
      .setExpirationTime(now + 90)
      .sign(pair.privateKey)

    const { verifyManagerReviewerSessionProof } =
      await import("./manager-reviewer-session-proof")
    await expect(verifyManagerReviewerSessionProof(proof)).resolves.toEqual(
      expect.objectContaining({
        actorId: "admin-user-1",
        authSubject: "auth-user-1",
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: "a".repeat(64),
      }),
    )
  })

  it("fails closed for a proof signed by an unconfigured Manager key", async () => {
    const configured = await generateKeyPair("EdDSA", { extractable: true })
    const rogue = await generateKeyPair("EdDSA", { extractable: true })
    mockEnv.env.SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS = JSON.stringify({
      "manager-test": await exportSPKI(configured.publicKey),
    })
    const now = Math.floor(Date.now() / 1_000)
    const proof = await new SignJWT({
      v: 1,
      env: "test",
      actorId: "admin-user-1",
      authSubject: "auth-user-1",
      assignmentId: "assignment-1",
      method: "GET",
      bodyDigest: "b".repeat(64),
      nonce: "manager-session-proof-nonce-2",
    })
      .setProtectedHeader({
        alg: "EdDSA",
        kid: "manager-test",
        typ: "manager-reviewer-session+jwt",
      })
      .setIssuer("forge-manager")
      .setAudience("forge-admin-subtitle-review-assertion")
      .setIssuedAt(now)
      .setExpirationTime(now + 90)
      .sign(rogue.privateKey)

    const { verifyManagerReviewerSessionProof } =
      await import("./manager-reviewer-session-proof")
    await expect(verifyManagerReviewerSessionProof(proof)).rejects.toThrow(
      "Invalid Manager reviewer session proof",
    )
  })

  it("rejects proofs whose environment or lifetime is outside the contract", async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true })
    mockEnv.env.SUBTITLE_REVIEW_SESSION_PUBLIC_KEYS = JSON.stringify({
      "manager-test": await exportSPKI(pair.publicKey),
    })
    const now = Math.floor(Date.now() / 1_000)
    const proof = await new SignJWT({
      v: 1,
      env: "production",
      actorId: "admin-user-1",
      authSubject: "auth-user-1",
      assignmentId: "assignment-1",
      method: "GET",
      bodyDigest: "c".repeat(64),
      nonce: "manager-session-proof-nonce-3",
    })
      .setProtectedHeader({
        alg: "EdDSA",
        kid: "manager-test",
        typ: "manager-reviewer-session+jwt",
      })
      .setIssuer("forge-manager")
      .setAudience("forge-admin-subtitle-review-assertion")
      .setIssuedAt(now)
      .setExpirationTime(now + 121)
      .sign(pair.privateKey)

    const { verifyManagerReviewerSessionProof } =
      await import("./manager-reviewer-session-proof")
    await expect(verifyManagerReviewerSessionProof(proof)).rejects.toThrow(
      "Invalid Manager reviewer session proof",
    )
  })
})
