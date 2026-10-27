import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  current: vi.fn(),
  grant: vi.fn(),
}))
vi.mock("@/server/session", () => ({
  createSignedSimulatorSession: mocks.create,
  currentSession: mocks.current,
}))
vi.mock("@/server/feedbackState", () => ({
  activeGrantForSession: mocks.grant,
}))
import { GET, POST } from "./route"

const origin = "https://web-staging-7801.up.railway.app"
const keys = generateKeyPairSync("ed25519")
const kid = createHash("sha256")
  .update(keys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex")
  .slice(0, 16)
function signed() {
  const now = Math.floor(Date.now() / 1000)
  const parts = [
    { alg: "EdDSA", typ: "JWT", kid },
    {
      iss: "forge-tv-simulator",
      aud: origin,
      scope: "tv-feedback:simulator",
      iat: now,
      exp: now + 3600,
      jti: "329de212-a8c3-4bba-87ef-839acebd5694",
    },
  ].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
  const body = parts.join(".")
  return `${body}.${sign(null, Buffer.from(body), keys.privateKey).toString("base64url")}`
}
function request(body: object, requestOrigin = origin) {
  return new Request(`${origin}/api/feedback/simulator/claim`, {
    method: "POST",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "true")
  vi.stubEnv(
    "FEEDBACK_SIMULATOR_PUBLIC_KEY",
    keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  )
  vi.stubEnv("FEEDBACK_SIMULATOR_AUDIENCE", origin)
  vi.stubEnv("FEEDBACK_BASE_URL", `${origin}/tv`)
  mocks.create.mockResolvedValue({
    referenceCode: "SIMULATOR-test",
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
  })
})
afterEach(() => vi.unstubAllEnvs())
it("allows repeated explicit valid claims without requiring IP, device or a browser challenge", async () => {
  const token = signed()
  for (let count = 0; count < 5; count++) {
    const result = await POST(request({ token }))
    expect(result.status).toBe(201)
    expect(result.headers.get("Cache-Control")).toBe("no-store")
    expect(await result.json()).toHaveProperty("simulator", true)
  }
  expect(mocks.create).toHaveBeenCalledTimes(5)
})
it("rejects other origins and forged source markers before creating a session", async () => {
  expect(
    (await POST(request({ token: signed() }, "https://other.example"))).status,
  ).toBe(403)
  expect(
    (await POST(request({ token: signed(), source: "signed-simulator" })))
      .status,
  ).toBe(403)
  expect((await POST(request({ token: "not-a-token" }))).status).toBe(403)
  expect(mocks.create).not.toHaveBeenCalled()
})
it("fails closed when disabled and never mistakes a native session for a simulator claim", async () => {
  mocks.current.mockResolvedValue("session")
  mocks.grant.mockResolvedValue({ reference: "NATIVE" })
  expect((await GET()).status).toBe(403)
  vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "false")
  expect((await POST(request({ token: signed() }))).status).toBe(404)
  expect((await GET()).status).toBe(404)
  expect(mocks.create).not.toHaveBeenCalled()
})
