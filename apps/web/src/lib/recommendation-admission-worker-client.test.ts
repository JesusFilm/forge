import { AsyncLocalStorage } from "node:async_hooks"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { createAdmissionWorkerClient } from "./recommendation-admission-worker-client"

const directory = mkdtempSync(join(tmpdir(), "admission-worker-"))
const clients: ReturnType<typeof createAdmissionWorkerClient>[] = []
function fixture(name: string, body: string, maxPending?: number) {
  const workerFile = join(directory, `${name}.cjs`)
  writeFileSync(
    workerFile,
    `const {workerData}=require('node:worker_threads'); const port=workerData.port; ${body}`,
  )
  const client = createAdmissionWorkerClient({
    workerFile,
    redisUrl: "redis://127.0.0.1:1",
    maxPending,
  })
  clients.push(client)
  return client
}
const success = `port.on('message', request => port.postMessage({ id:request.id, result:{allowed:true}, finishedAt:performance.timeOrigin+performance.now() }));`
const call = (client: ReturnType<typeof createAdmissionWorkerClient>) =>
  client.admit("digest-client", "digest-aggregate", "profile-status")

afterAll(() => {
  for (const client of clients) client.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("admission worker lifecycle", () => {
  it("preserves successful results and fails closed without Redis configuration", async () => {
    await expect(call(fixture("success", success))).resolves.toEqual({
      allowed: true,
    })
    const absent = createAdmissionWorkerClient({ redisUrl: "" })
    clients.push(absent)
    await expect(call(absent)).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
  })

  it("logs failures in each caller's context rather than the shared worker listener's context", async () => {
    const context = new AsyncLocalStorage<string>()
    const observed: (string | undefined)[] = []
    const logger = vi.spyOn(console, "info").mockImplementation(() => {
      observed.push(context.getStore())
    })
    try {
      const client = fixture(
        "contexts",
        `port.on('message', request => port.postMessage({id:request.id,result:{allowed:false,reason:'admission_unavailable'},finishedAt:performance.timeOrigin+performance.now()}));`,
      )
      await Promise.all([
        context.run("first", () => call(client)),
        context.run("second", () => call(client)),
      ])
      expect(observed.sort()).toEqual(["first", "second"])
    } finally {
      logger.mockRestore()
    }
  })

  it("bounds pending requests without cancelling the admitted request", async () => {
    const client = fixture("capacity", success, 1)
    const first = call(client)
    await expect(call(client)).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    await expect(first).resolves.toEqual({ allowed: true })
  })

  it("rejects work completed after the original deadline", async () => {
    const client = fixture(
      "late",
      `port.on('message', request => port.postMessage({ id:request.id, result:{allowed:true}, finishedAt:request.deadlineAt+1 }));`,
    )
    await expect(call(client)).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
  })

  it("fails pending calls on worker exit and applies a retry backoff", async () => {
    const client = fixture("exit", "process.exit(1)")
    const calls = [call(client), call(client)]
    expect(await Promise.all(calls)).toEqual([
      { allowed: false, reason: "admission_unavailable" },
      { allowed: false, reason: "admission_unavailable" },
    ])
    await expect(call(client)).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
  })

  it("drains a concurrent playback result after a stalled profile call times out", async () => {
    const client = fixture(
      "drain",
      `port.on('message', request => { if(request.namespace==='playback-context') setTimeout(() => port.postMessage({id:request.id,result:{allowed:true},finishedAt:performance.timeOrigin+performance.now()}),530) });`,
    )
    const profile = call(client)
    const playback = client.admit("client", "aggregate", "playback-context")
    await expect(profile).resolves.toEqual({
      allowed: false,
      reason: "admission_unavailable",
    })
    await expect(playback).resolves.toEqual({ allowed: true })
  })
})
