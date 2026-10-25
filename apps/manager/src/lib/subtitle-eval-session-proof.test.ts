import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importSPKI,
  jwtVerify,
} from "jose"
import { describe, expect, it } from "vitest"

import { createSubtitleEvalSessionProof } from "./subtitle-eval-session-proof"

describe("subtitle evaluation Manager session proof", () => {
  it("binds the HttpOnly-session actor to exactly one operation and payload", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    })
    const assertion = await createSubtitleEvalSessionProof(
      {
        actorId: "user-1",
        authSubject: "auth-user-1",
        operation: "CREATE_RUN",
        method: "POST",
        bodyDigest: "a".repeat(64),
      },
      {
        environment: "test",
        keyId: "manager-key-1",
        privateKey: await exportPKCS8(privateKey),
        now: new Date("2026-08-20T12:00:00.000Z"),
        nonce: "01234567-89ab-cdef-0123-456789abcdef",
      },
    )
    const verified = await jwtVerify(
      assertion,
      await importSPKI(await exportSPKI(publicKey), "EdDSA"),
      {
        issuer: "forge-manager",
        audience: "forge-admin-subtitle-review-assertion",
        currentDate: new Date("2026-08-20T12:00:30.000Z"),
      },
    )
    expect(verified.payload).toMatchObject({
      actorId: "user-1",
      authSubject: "auth-user-1",
      operation: "CREATE_RUN",
      method: "POST",
      bodyDigest: "a".repeat(64),
    })
    expect(verified.payload).not.toHaveProperty("assignmentId")
  })

  it("rejects ambiguous assignment and operation authority", async () => {
    await expect(
      createSubtitleEvalSessionProof(
        {
          actorId: "user-1",
          authSubject: "auth-user-1",
          assignmentId: "assignment-1",
          operation: "CREATE_RUN",
          method: "POST",
          bodyDigest: "a".repeat(64),
        },
        {
          environment: "test",
          keyId: "manager-key-1",
          privateKey: "unused",
        },
      ),
    ).rejects.toThrow(/exactly one/i)
  })
})
