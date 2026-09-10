const { AbortController, setTimeout, clearTimeout, Buffer } = globalThis
import { createServer } from "node:http"
import { createHash, randomUUID, verify } from "node:crypto"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { finished } from "node:stream/promises"
import {
  studioRenderAdmissionSchema,
  STUDIO_RENDER_WIRE_BYTES,
  STUDIO_RENDER_PROFILE,
} from "@forge/studio-contracts/render"
import { verifyExecutionBudget, currentCgroupDirectory } from "./budget.mjs"
import { executeStudioChild, StudioExecutionError } from "./isolation.mjs"

/** Credential-free executor: only the broker's public verification key is held.
 * Canonical leases/results belong to Admin, never this process-local replay map. */
export async function createExecutionService(config) {
  if (!config.paths.verifyChild || !config.paths.codec)
    throw new StudioExecutionError(
      "INVALID",
      "Independent pinned verifier is required",
    )
  const timeoutMs = config.timeoutMs ?? STUDIO_RENDER_PROFILE.jobMs
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > STUDIO_RENDER_PROFILE.jobMs
  )
    throw new StudioExecutionError("INVALID", "Invalid job deadline")
  const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n)
  const budget = await verifyExecutionBudget(await currentCgroupDirectory())
  const instanceId = randomUUID(),
    seen = new Map()
  let busy = false,
    active = null,
    healthy = true
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    const reply = (status, code) => {
      if (!res.headersSent)
        res
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify({ code }))
    }
    if (req.url === "/health" && req.method === "GET") {
      res
        .writeHead(healthy ? 200 : 503, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            instanceId,
            budget,
            busy,
            healthy,
            profileId: STUDIO_RENDER_PROFILE.id,
          }),
        )
      return
    }
    if (req.url !== "/render" || req.method !== "POST") {
      reply(404, "NOT_FOUND")
      return
    }
    const signature = req.headers["x-shorts-admission"]
    if (
      typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature)
    ) {
      reply(403, "AUTHORITY")
      return
    }
    if (!healthy || busy) {
      reply(409, "BUSY")
      return
    }
    busy = true
    let deadlineMs = monotonicMs() + timeoutMs
    const abort = new AbortController()
    active = abort
    const disconnected = () => {
      if (!res.writableEnded) abort.abort()
    }
    res.once("close", disconnected)
    let timedOut = false
    const deadline = setTimeout(
      () => {
        timedOut = true
        abort.abort()
        req.destroy()
      },
      Math.min(STUDIO_RENDER_PROFILE.uploadMs, timeoutMs),
    )
    let jobDeadline = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, timeoutMs)
    let directory,
      delivering = false
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        if (abort.signal.aborted)
          throw new StudioExecutionError("INVALID", "request expired")
        size += chunk.length
        if (size > STUDIO_RENDER_WIRE_BYTES) {
          reply(413, "INPUT_LIMIT")
          req.destroy()
          return
        }
        chunks.push(chunk)
      }
      let bytes = Buffer.concat(chunks, size)
      chunks.length = 0
      if (
        !verify(null, bytes, config.publicKey, Buffer.from(signature, "base64"))
      ) {
        reply(403, "AUTHORITY")
        return
      }
      const parsed = studioRenderAdmissionSchema.safeParse(
        JSON.parse(bytes.toString()),
      )
      bytes = null
      if (!parsed.success) {
        reply(400, "INPUT")
        return
      }
      const admission = parsed.data,
        now = Date.now()
      if (
        admission.instanceId !== instanceId ||
        admission.issuedAt > now + 5000 ||
        admission.expiresAt < now ||
        admission.expiresAt - admission.issuedAt > 60000
      ) {
        reply(409, "EXPIRED")
        return
      }
      // Signed absolute expiry caps even delayed requests; convert once to the
      // native monotonic clock so later wall-clock changes cannot extend execution.
      if (
        admission.executionExpiresAt <= now ||
        admission.executionExpiresAt - admission.issuedAt >
          STUDIO_RENDER_PROFILE.jobMs
      ) {
        reply(409, "EXPIRED")
        return
      }
      deadlineMs = Math.min(
        deadlineMs,
        monotonicMs() + admission.executionExpiresAt - now,
      )
      clearTimeout(jobDeadline)
      jobDeadline = setTimeout(
        () => {
          timedOut = true
          abort.abort()
        },
        Math.max(1, deadlineMs - monotonicMs()),
      )
      for (const [key, expiry] of seen) if (expiry < now) seen.delete(key)
      const key = `${admission.attemptId}:${admission.leaseId}`
      if (seen.has(key) || seen.size >= 128) {
        reply(409, "CONSUMED")
        return
      }
      seen.set(key, admission.expiresAt)
      directory = await mkdtemp(join(config.root, "job-"))
      for (const file of admission.files) {
        if (
          file.base64.length !== 4 * Math.ceil(file.size / 3) ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)
        )
          throw new StudioExecutionError("INVALID", "invalid base64")
        const bytes = Buffer.from(file.base64, "base64")
        if (
          bytes.length !== file.size ||
          createHash("sha256").update(bytes).digest("hex") !== file.digest
        )
          throw new StudioExecutionError("INVALID", "digest mismatch")
        await writeFile(join(directory, file.name), bytes, {
          flag: "wx",
          mode: 0o400,
        })
        file.base64 = ""
      }
      await writeFile(
        join(directory, "input.json"),
        JSON.stringify(admission.input),
        { flag: "wx", mode: 0o400 },
      )
      clearTimeout(deadline)
      const output = await executeStudioChild(
        { ...config.paths, input: directory, deadlineMs },
        abort.signal,
      )
      await rm(directory, { recursive: true, force: true })
      directory = await mkdtemp(join(config.root, "verify-"))
      const digest = createHash("sha256").update(output).digest("hex")
      const { width, height, fps, durationInFrames } = admission.input.document
      await writeFile(
        join(directory, "input.json"),
        JSON.stringify({ digest, width, height, fps, durationInFrames }),
        { flag: "wx", mode: 0o400 },
      )
      await writeFile(join(directory, "output.mp4"), output, {
        flag: "wx",
        mode: 0o400,
      })
      const verification = await executeStudioChild(
        {
          ...config.paths,
          input: directory,
          child: config.paths.verifyChild,
          renderer: undefined,
          browser: undefined,
          bundle: undefined,
          dependencies: undefined,
          stdoutBytes: 8192,
          deadlineMs,
        },
        abort.signal,
      )
      const proof = JSON.parse(verification.toString())
      if (proof.outputDigest !== digest || proof.decoded !== true)
        throw new StudioExecutionError(
          "INVALID",
          "Invalid independent codec proof",
        )
      if (monotonicMs() >= deadlineMs)
        throw new StudioExecutionError("TIMEOUT", "Job deadline exceeded")
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": output.length,
        "x-shorts-output-sha256": digest,
        "x-shorts-verification": verification.toString("base64"),
        "x-shorts-attempt": admission.attemptId,
        "x-shorts-lease": admission.leaseId,
      })
      delivering = true
      const delivered = finished(res, { cleanup: true, signal: abort.signal })
      res.end(output)
      await delivered
    } catch (error) {
      if (error?.code === "ISOLATION_LOST") {
        healthy = false
        reply(503, "ISOLATION_LOST")
        // Never accept another job with uncertain teardown. Entry point handles
        // this fatal event by exiting PID1, retiring the whole container.
        server.emit("isolationLost")
      } else if (timedOut || error?.code === "TIMEOUT") reply(422, "TIMEOUT")
      else
        reply(
          error?.code === "CANCELLED" ? 409 : 422,
          error?.code ?? "INVALID_EXECUTION",
        )
    } finally {
      if (delivering && !res.writableFinished) res.destroy()
      clearTimeout(deadline)
      clearTimeout(jobDeadline)
      res.removeListener("close", disconnected)
      if (directory) await rm(directory, { recursive: true, force: true })
      active = null
      busy = false
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 5000
  server.maxConnections = 4
  return { server, instanceId, stop: () => active?.abort() }
}
