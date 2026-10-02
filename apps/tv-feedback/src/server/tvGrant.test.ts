import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  canonicalGrantRequest,
  nextUtcMidnight,
  publicKeyMatches,
} from "../lib/grantProof"

describe("TV QR proof binding", () => {
  it("accepts only a signature for the exact challenge and installation", () => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKey = keys.publicKey.export({ format: "der", type: "spki" })
    const input = {
      challengeId: "a896423a-97df-469e-8c62-8bb22f962e39",
      installationId: "97fe3640-6627-462b-a499-f789dcc48965",
      publicKey: publicKey.toString("base64url"),
      keyFingerprint: createHash("sha256")
        .update(publicKey)
        .digest("base64url"),
      packageName: "org.jesusfilm.tv",
      versionCode: 2,
      tvMode: true,
      signature: "",
      integrityToken: "x".repeat(100),
    }
    const canonical = canonicalGrantRequest(input, "server-nonce", "2026-09-23")
    input.signature = sign(
      "sha256",
      Buffer.from(canonical),
      keys.privateKey,
    ).toString("base64url")
    expect(publicKeyMatches(input, canonical)).toBe(true)
    expect(
      publicKeyMatches(input, canonical.replace("server-nonce", "changed")),
    ).toBe(false)
    expect(
      publicKeyMatches(
        { ...input, installationId: "another" },
        canonicalGrantRequest(
          { ...input, installationId: "another" },
          "server-nonce",
          "2026-09-23",
        ),
      ),
    ).toBe(false)
  })

  it("uses server UTC midnight", () => {
    expect(nextUtcMidnight("2026-09-23").toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    )
  })
})
