import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  signedSimulatorConfig,
  signedSimulatorSessionAllowed,
  verifySimulatorToken,
} from "./signedSimulator"

const audience = "https://web-staging-920a.up.railway.app"
const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const kid = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex")
  .slice(0, 16)
const config = { audience, publicKey, keyId: kid }
const now = 200000
const claims = {
  iss: "forge-tv-simulator",
  aud: audience,
  scope: "tv-feedback:simulator",
  iat: now,
  exp: now + 3600,
  jti: "329de212-a8c3-4bba-87ef-839acebd5694",
}
function token(
  payload: object = claims,
  header: object = { alg: "EdDSA", typ: "JWT", kid },
  key = privateKey,
) {
  const body = [header, payload]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".")
  return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`
}
afterEach(() => vi.unstubAllEnvs())

describe("signed simulator authorization", () => {
  it("accepts the actual developer issuer's token format", async () => {
    const { issueLink } = await import("../../scripts/simulator-token.mjs")
    const issued = issueLink(privateKey, { now, ttl: 3600, id: claims.jti })
    expect(
      verifySimulatorToken(new URL(issued.url).hash.slice(7), config, now),
    ).toEqual(claims)
  })
  it("verifies reusable signed links for any caller until expiry", () => {
    const value = token()
    expect(verifySimulatorToken(value, config, now)).toEqual(claims)
    expect(verifySimulatorToken(value, config, now + 3599)).toEqual(claims)
    expect(() => verifySimulatorToken(value, config, now + 3600)).toThrow()
  })
  it.each([
    { aud: "https://different.example" },
    { iss: "different" },
    { scope: "admin" },
    { iat: now + 61 },
    { exp: now },
    { exp: now + 7201 },
    { exp: now - 1 },
    { jti: "not-a-uuid" },
    { extra: "not-allowed" },
  ])("rejects invalid signed claims %j", (change) => {
    expect(() =>
      verifySimulatorToken(token({ ...claims, ...change }), config, now),
    ).toThrow()
  })
  it.each([
    { alg: "none" },
    { alg: "HS256" },
    { typ: "other" },
    { kid: "0000000000000000" },
  ])("rejects unsupported headers %j", (change) => {
    expect(() =>
      verifySimulatorToken(
        token(claims, { alg: "EdDSA", typ: "JWT", kid, ...change }),
        config,
        now,
      ),
    ).toThrow()
  })
  it("rejects tampering, another signing key and noncanonical encoding", () => {
    const value = token()
    const [header, payload, signature] = value.split(".")
    expect(() =>
      verifySimulatorToken(`${header}.${payload}x.${signature}`, config, now),
    ).toThrow()
    expect(() =>
      verifySimulatorToken(`${header}=.${payload}.${signature}`, config, now),
    ).toThrow()
    expect(() =>
      verifySimulatorToken(
        token(claims, undefined, generateKeyPairSync("ed25519").privateKey),
        config,
        now,
      ),
    ).toThrow()
    expect(() => verifySimulatorToken("x".repeat(4097), config, now)).toThrow()
    expect(() => verifySimulatorToken(`${value}.extra`, config, now)).toThrow()
  })
  it("pins enabled configuration to an Ed25519 public key and exact server origin", () => {
    vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "true")
    vi.stubEnv("FEEDBACK_SIMULATOR_AUDIENCE", audience)
    vi.stubEnv("FEEDBACK_BASE_URL", `${audience}/tv`)
    vi.stubEnv(
      "FEEDBACK_SIMULATOR_PUBLIC_KEY",
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    )
    expect(signedSimulatorConfig()?.keyId).toBe(kid)
    expect(
      signedSimulatorSessionAllowed({
        source: "signed-simulator",
        signingKeyId: kid,
      }),
    ).toBe(true)
    expect(
      signedSimulatorSessionAllowed({
        source: "signed-simulator",
        signingKeyId: "other",
      }),
    ).toBe(false)
    vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "false")
    expect(signedSimulatorConfig()).toBeNull()
    expect(
      signedSimulatorSessionAllowed({
        source: "signed-simulator",
        signingKeyId: kid,
      }),
    ).toBe(false)
    expect(signedSimulatorSessionAllowed({})).toBe(true)
  })
  it("fails closed for incorrect key type, private key input and audience configuration", () => {
    vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "true")
    vi.stubEnv("FEEDBACK_SIMULATOR_AUDIENCE", audience)
    vi.stubEnv("FEEDBACK_BASE_URL", audience)
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    vi.stubEnv(
      "FEEDBACK_SIMULATOR_PUBLIC_KEY",
      createPublicKey(ec.privateKey)
        .export({ type: "spki", format: "pem" })
        .toString(),
    )
    expect(signedSimulatorConfig()).toBeNull()
    vi.stubEnv(
      "FEEDBACK_SIMULATOR_PUBLIC_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    )
    expect(signedSimulatorConfig()).toBeNull()
    vi.stubEnv(
      "FEEDBACK_SIMULATOR_PUBLIC_KEY",
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    )
    vi.stubEnv("FEEDBACK_BASE_URL", "https://different.example/tv")
    expect(signedSimulatorConfig()).toBeNull()
  })
})
