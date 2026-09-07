const { fetch, Buffer, performance, setTimeout } = globalThis
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { test } from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign, randomUUID, createHash } from "node:crypto"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createExecutionService } from "../src/service.mjs"

test(
  "signed one-use admission runs a real child and rejects altered bytes/replay",
  { skip: process.env.STUDIO_CGROUP_CHECK !== "1", timeout: 15000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "studio460-http-"))
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const output = await readFile(
      "/tmp/forge-studio-460-runtime/text-output.mp4",
    )
    const child = join(root, "child.mjs")
    await writeFile(
      child,
      `process.stdout.write(Buffer.from('${output.toString("base64")}','base64'))`,
    )
    const service = await createExecutionService({
      publicKey,
      root,
      paths: {
        nativeDir: resolve("apps/studio-render/dist"),
        node: process.execPath,
        child,
        verifyChild: resolve("apps/studio-render/src/verify.mjs"),
        codec: process.env.STUDIO_CODEC_DIR,
      },
      timeoutMs: 3000,
    })
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done))
    const origin = `http://127.0.0.1:${service.server.address().port}`
    try {
      const health = await (await fetch(origin + "/health")).json()
      assert.equal(health.profileId, STUDIO_RENDER_PROFILE.id)
      const request = {
        version: 1,
        profileId: STUDIO_RENDER_PROFILE.id,
        executionExpiresAt: Date.now() + 5000,
        instanceId: health.instanceId,
        attemptId: "attempt-460",
        leaseId: randomUUID(),
        inputHash: "a".repeat(64),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 5000,
        input: {
          document: {
            version: 1,
            title: "HTTP render",
            language: "english",
            runtimeVersion:
              "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16",
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
        },
        files: [],
      }
      const body = JSON.stringify(request)
      const signature = sign(null, Buffer.from(body), privateKey).toString(
        "base64",
      )
      const send = (body) =>
        fetch(origin + "/render", {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "x-studio-admission": signature,
          },
        })
      assert.equal((await send(body + " ")).status, 403)
      const expiredBody = JSON.stringify({
        ...request,
        executionExpiresAt: Date.now() - 1,
      })
      const expired = await fetch(origin + "/render", {
        method: "POST",
        body: expiredBody,
        headers: {
          "x-studio-admission": sign(
            null,
            Buffer.from(expiredBody),
            privateKey,
          ).toString("base64"),
        },
      })
      assert.equal(expired.status, 409)
      assert.deepEqual(await expired.json(), { code: "EXPIRED" })
      const response = await send(body)
      assert.equal(response.status, 200, await response.clone().text())
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), output)
      assert.ok(response.headers.get("x-studio-verification"))
      assert.equal(
        response.headers.get("x-studio-output-sha256"),
        createHash("sha256").update(output).digest("hex"),
      )
      assert.equal((await send(body)).status, 409)
    } finally {
      await new Promise((done) => service.server.close(done))
      await rm(root, { recursive: true, force: true })
    }
  },
)

test(
  "staging, render and verification share one native monotonic job deadline",
  { skip: process.env.STUDIO_CGROUP_CHECK !== "1", timeout: 10000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "studio460-total-deadline-"))
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const output = await readFile(
      "/tmp/forge-studio-460-runtime/text-output.mp4",
    )
    const child = join(root, "child.mjs"),
      verifyChild = join(root, "verify.mjs")
    await writeFile(
      child,
      `await new Promise(r=>setTimeout(r,250));process.stdout.write(Buffer.from('${output.toString("base64")}','base64'))`,
    )
    await writeFile(
      verifyChild,
      `import{readFileSync}from'node:fs';await new Promise(r=>setTimeout(r,250));process.stdout.write(JSON.stringify({outputDigest:JSON.parse(readFileSync('/input/input.json')).digest,decoded:true}))`,
    )
    const service = await createExecutionService({
      publicKey,
      root,
      paths: {
        nativeDir: resolve("apps/studio-render/dist"),
        node: process.execPath,
        child,
        verifyChild,
        codec: process.env.STUDIO_CODEC_DIR,
      },
      timeoutMs: 400,
    })
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done))
    const origin = `http://127.0.0.1:${service.server.address().port}`
    try {
      const request = {
        version: 1,
        profileId: STUDIO_RENDER_PROFILE.id,
        executionExpiresAt: Date.now() + 5000,
        instanceId: service.instanceId,
        attemptId: "deadline-460",
        leaseId: randomUUID(),
        inputHash: "a".repeat(64),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 5000,
        input: {
          document: {
            version: 1,
            title: "Deadline",
            language: "english",
            runtimeVersion:
              "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16",
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
        },
        files: [],
      }
      const body = JSON.stringify(request),
        signature = sign(null, Buffer.from(body), privateKey).toString("base64")
      const started = performance.now()
      const response = await fetch(origin + "/render", {
        method: "POST",
        body,
        headers: { "x-studio-admission": signature },
      })
      assert.ok(
        performance.now() - started < 1500,
        "deadline plus bounded teardown",
      )
      assert.equal(response.status, 422)
      assert.deepEqual(await response.json(), { code: "TIMEOUT" })
      assert.equal((await fetch(origin + "/health")).status, 200)
    } finally {
      await new Promise((done) => service.server.close(done))
      await rm(root, { recursive: true, force: true })
    }
  },
)

test(
  "stalled response reader cannot retain the execution slot past the total deadline",
  { skip: process.env.STUDIO_CGROUP_CHECK !== "1", timeout: 10000 },
  async () => {
    const { request: httpRequest } = await import("node:http")
    const root = await mkdtemp(join(tmpdir(), "studio460-stalled-reader-"))
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const child = join(root, "child.mjs"),
      verifyChild = join(root, "verify.mjs")
    // This fixture isolates HTTP delivery; actual codec certification is tested
    // separately with the pinned fresh-namespace FFmpeg verifier.
    const outputSize = 16 * 1024 * 1024
    await writeFile(
      child,
      `process.stdout.write(Buffer.alloc(${outputSize},42))`,
    )
    await writeFile(
      verifyChild,
      `import{readFileSync}from'node:fs';process.stdout.write(JSON.stringify({outputDigest:JSON.parse(readFileSync('/input/input.json')).digest,decoded:true}))`,
    )
    const service = await createExecutionService({
      publicKey,
      root,
      paths: {
        nativeDir: resolve("apps/studio-render/dist"),
        node: process.execPath,
        child,
        verifyChild,
        codec: process.env.STUDIO_CODEC_DIR,
      },
      timeoutMs: 1000,
    })
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done))
    const origin = `http://127.0.0.1:${service.server.address().port}`
    let response, request
    try {
      const body = JSON.stringify({
        version: 1,
        profileId: STUDIO_RENDER_PROFILE.id,
        executionExpiresAt: Date.now() + 5000,
        instanceId: service.instanceId,
        attemptId: "stalled-reader",
        leaseId: randomUUID(),
        inputHash: "a".repeat(64),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 5000,
        input: {
          document: {
            version: 1,
            title: "Delivery deadline",
            language: "english",
            runtimeVersion:
              "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16",
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
        },
        files: [],
      })
      response = await new Promise((done, fail) => {
        request = httpRequest(
          origin + "/render",
          {
            method: "POST",
            headers: {
              "x-studio-admission": sign(
                null,
                Buffer.from(body),
                privateKey,
              ).toString("base64"),
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            res.pause()
            res.on("error", () => {})
            done(res)
          },
        )
        request.once("error", fail)
        request.end(body)
      })
      assert.equal(response.statusCode, 200)
      assert.equal(response.headers["content-length"], String(outputSize))
      assert.equal((await (await fetch(origin + "/health")).json()).busy, true)
      await new Promise((done) => setTimeout(done, 1100))
      const health = await (await fetch(origin + "/health")).json()
      assert.equal(health.busy, false)
      assert.equal(health.healthy, true)
      let received = 0
      response.on("data", (chunk) => (received += chunk.length))
      const closed = new Promise((done) => response.once("close", done))
      response.resume()
      await closed
      assert.equal(response.complete, false)
      assert.ok(
        received < outputSize,
        "deadline must truncate blocked delivery",
      )
    } finally {
      response?.destroy()
      request?.destroy()
      service.stop()
      service.server.closeAllConnections()
      await new Promise((done) => service.server.close(done))
      await rm(root, { recursive: true, force: true })
    }
  },
)
