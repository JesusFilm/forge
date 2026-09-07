import { createHash, generateKeyPairSync } from "node:crypto"
import { SignJWT, importPKCS8 } from "jose"
import { beforeAll, expect, it, vi } from "vitest"
import { STUDIO_INTERACTIVE_AUDIENCE } from "@forge/studio-contracts/transport"
const config = vi.hoisted(() => ({
  STUDIO_ENVIRONMENT: "local",
  STUDIO_INTERACTIVE_PUBLIC_KEYS: "",
}))
vi.mock("@/config/env", () => ({ env: config }))
import { verifyStudioInteractive } from "./studio-interactive"
import { ForbiddenError } from "@/services/errors"
const body = JSON.stringify({ action: "approve", input: { projectId: "one" } })
let key: Awaited<ReturnType<typeof importPKCS8>>
beforeAll(async () => {
  const pair = generateKeyPairSync("ed25519")
  config.STUDIO_INTERACTIVE_PUBLIC_KEYS = JSON.stringify({
    fixture: pair.publicKey.export({ type: "spki", format: "pem" }),
  })
  key = await importPKCS8(
    String(pair.privateKey.export({ type: "pkcs8", format: "pem" })),
    "EdDSA",
  )
})
async function sign(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: "trusted-user",
    iss: "forge-manager",
    aud: STUDIO_INTERACTIVE_AUDIENCE,
    iat: now,
    exp: now + 60,
    environment: "local",
    digest: createHash("sha256").update(body).digest("hex"),
    ...overrides,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "studio-interactive+jwt",
      kid: "fixture",
    })
    .sign(key)
}
it("binds a trusted user assertion to the exact command body", async () => {
  const token = await sign()
  expect(await verifyStudioInteractive(token, body)).toBe("trusted-user")
  await expect(
    verifyStudioInteractive(token, body + " "),
  ).rejects.toBeInstanceOf(ForbiddenError)
  await expect(verifyStudioInteractive(null, body)).rejects.toBeInstanceOf(
    ForbiddenError,
  )
})
it.each([
  { environment: "production" },
  { aud: "mcp" },
  { iss: "external-agent" },
  { exp: 1 },
  { exp: Math.floor(Date.now() / 1000) + 3600 },
])("rejects a wrong authority or lifetime %j", async (claims) => {
  await expect(
    verifyStudioInteractive(await sign(claims), body),
  ).rejects.toBeInstanceOf(ForbiddenError)
})
