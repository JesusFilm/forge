import { createServer } from "node:http"
import {
  generateKeyPairSync,
  verify,
  createHash,
  randomUUID,
} from "node:crypto"
import { afterAll, beforeAll, expect, it } from "vitest"
import {
  STUDIO_RENDER_PROFILE,
  STUDIO_CODEC_VERIFIER_VERSION,
} from "@forge/studio-contracts/render"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { executeStudioRenderRequest } from "./studio-render-execution"
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const instanceId = randomUUID(),
  leaseId = randomUUID(),
  output = Buffer.from("transport-only-output")
const digest = createHash("sha256").update(output).digest("hex")
let endpoint = "",
  tamper = false,
  requests = 0
const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.end(
      JSON.stringify({
        instanceId,
        healthy: true,
        busy: false,
        profileId: STUDIO_RENDER_PROFILE.id,
      }),
    )
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const bytes = Buffer.concat(chunks)
  expect(
    verify(
      null,
      bytes,
      publicKey,
      Buffer.from(String(req.headers["x-shorts-admission"]), "base64"),
    ),
  ).toBe(true)
  const admission = JSON.parse(bytes.toString())
  expect(admission.profileId).toBe(STUDIO_RENDER_PROFILE.id)
  expect(admission.executionExpiresAt - admission.issuedAt).toBe(
    STUDIO_RENDER_PROFILE.jobMs,
  )
  requests++
  const proof = {
    version: 1,
    verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
    outputDigest: digest,
    decoded: true,
    video: {
      codec: "h264",
      width: 320,
      height: 180,
      fps: 30,
      frames: 30,
      durationMs: 1000,
    },
    audio: { codec: "aac", sampleRate: 48000, channels: 2, durationMs: 1000 },
  }
  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": output.length,
    "x-shorts-attempt": "transport-attempt",
    "x-shorts-lease": leaseId,
    "x-shorts-output-sha256": digest,
    "x-shorts-verification": Buffer.from(JSON.stringify(proof)).toString(
      "base64",
    ),
  })
  res.end(tamper ? Buffer.alloc(output.length) : output)
})
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Address")
  endpoint = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})
const input = {
  document: {
    version: 1 as const,
    title: "Transport",
    language: "english",
    runtimeVersion: STUDIO_RUNTIME_VERSION,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
  media: {},
  code: {},
}
const run = (
  url = endpoint,
  expiresAt = Date.now() + STUDIO_RENDER_PROFILE.leaseMs,
) =>
  executeStudioRenderRequest(
    { endpoint: url, privateKey },
    {
      attemptId: "transport-attempt",
      leaseId,
      inputHash: "a".repeat(64),
      leaseExpiresAt: expiresAt,
      input,
      files: [],
    },
    new AbortController().signal,
  )
it("signs bounded private execution and verifies exact response bytes/binding", async () => {
  tamper = false
  const result = await run()
  expect(result.output).toEqual(output)
  expect(result.proof.outputDigest).toBe(digest)
})
it("rejects public-edge transport and insufficient lease before dispatch", async () => {
  const before = requests
  await expect(run("https://renderer.example.org")).rejects.toThrow("private")
  await expect(run(endpoint, Date.now() + 500)).rejects.toThrow("lease")
  expect(requests).toBe(before)
})
it("rejects corrupted output despite ready verification headers", async () => {
  tamper = true
  await expect(run()).rejects.toThrow("digest")
})
