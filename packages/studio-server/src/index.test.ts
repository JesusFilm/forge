import { expect, test } from "vitest"
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose"
import { signStudioRequest, verifyStudioRequest } from "./index"
test("scoped signed request binds user, authority, body, audience and environment", async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true })
  const privateKey = await exportPKCS8(pair.privateKey),
    publicKeys = JSON.stringify({ test: await exportSPKI(pair.publicKey) })
  const token = await signStudioRequest(
    "body",
    "runtime",
    {
      sub: "operator",
      authority: "delegated",
      clientId: "claude",
      scopes: ["studio:edit"],
    },
    { privateKey, keyId: "test", environment: "local" },
  )
  expect(
    (
      await verifyStudioRequest(token, "body", "runtime", {
        publicKeys,
        environment: "local",
      })
    ).authority,
  ).toBe("delegated")
  await expect(
    verifyStudioRequest(token, "changed", "runtime", {
      publicKeys,
      environment: "local",
    }),
  ).rejects.toThrow()
  await expect(
    verifyStudioRequest(token, "body", "interactive", {
      publicKeys,
      environment: "local",
    }),
  ).rejects.toThrow()
  await expect(
    verifyStudioRequest(token, "body", "runtime", {
      publicKeys,
      environment: "production",
    }),
  ).rejects.toThrow()
})
