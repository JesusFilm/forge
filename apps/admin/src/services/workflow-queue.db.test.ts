import { fork, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, describe, expect, it } from "vitest"

type Delivery = {
  body: { correlationId?: string; runInput?: { input: unknown } }
  attempt: number
  headers: Record<string, string>
  url: string
}

const processes: ChildProcess[] = []
const databaseUrl = process.env.WORKFLOW_QUEUE_TEST_DATABASE_URL

async function startProcess(prefix: string, runner: string | undefined) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WORKFLOW_QUEUE_TEST_DATABASE_URL: databaseUrl,
    WORKFLOW_QUEUE_TEST_PREFIX: prefix,
  }
  // Verify the unset SDK default independently of the test runner's environment.
  delete env.WORKFLOW_RUNNER_ENABLED
  if (runner !== undefined) env.WORKFLOW_RUNNER_ENABLED = runner
  const child = fork(resolve("scripts/workflow-queue-test-process.mjs"), {
    env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  })
  processes.push(child)
  let stderr = ""
  child.stderr?.on("data", (data) => (stderr += String(data)))
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  const ready = new Promise<void>((resolveReady, reject) => {
    child.on("error", reject)
    child.on("exit", (code) => {
      const error = new Error(`Queue process exited (${code}): ${stderr}`)
      reject(error)
      for (const request of pending.values()) request.reject(error)
      pending.clear()
    })
    child.on("message", (message) => {
      const reply = message as {
        ready?: boolean
        id: string
        result?: unknown
        error?: string
      }
      if (reply.ready) resolveReady()
      const request = pending.get(reply.id)
      if (!request) return
      pending.delete(reply.id)
      if (reply.error) request.reject(new Error(reply.error))
      else request.resolve(reply.result)
    })
  })
  await ready
  return async function call<T = unknown>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const id = randomUUID()
    return new Promise((resolveResult, reject) => {
      pending.set(id, {
        resolve: (value) => resolveResult(value as T),
        reject,
      })
      child.send({ id, command, ...args })
    })
  }
}

afterEach(() => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL")
  }
})

describe.skipIf(!databaseUrl)("Postgres workflow queue ownership", () => {
  it.each(["false", undefined])(
    "persists jobs without executing with runner %s, then retries and resumes in a separate worker",
    async (runner) => {
      const prefix = `test_${randomUUID()}_`
      const producer = await startProcess(prefix, runner)
      for (const id of ["normal", "normal", "retry", "resume"]) {
        await producer("queue", {
          queue: "__wkf_workflow_test",
          body: { __healthCheck: true, correlationId: id },
          options: {
            idempotencyKey: `${prefix}${id}`,
            headers: { "x-test": id },
          },
        })
      }
      // Several real LISTEN/poll cycles; a disabled producer must not consume.
      await delay(1500)
      expect(await producer("snapshot")).toEqual([])
      expect(await producer("cancel")).toBe("cancelled")
      await producer("queueBinary", { runId: `wrun_${randomUUID()}` })
      await producer("close")

      const worker = await startProcess(prefix, "true")
      await worker("start")
      await expect
        .poll(
          async () => {
            const rows = await worker<Delivery[]>("snapshot")
            return rows
              .filter((row) => row.body.correlationId)
              .map((row) => `${row.body.correlationId}:${row.attempt}`)
              .sort()
          },
          { timeout: 15_000, interval: 100 },
        )
        .toEqual(["normal:1", "resume:1", "resume:1", "retry:1", "retry:2"])
      const rows = await worker<Delivery[]>("snapshot")
      expect(rows.filter((row) => row.body.runInput)).toEqual([
        expect.objectContaining({
          body: expect.objectContaining({
            runInput: expect.objectContaining({
              input: { __type: "Uint8Array", data: "AH//" },
            }),
          }),
        }),
      ])
      expect(
        rows.every((row) => row.url === "/.well-known/workflow/v1/flow"),
      ).toBe(true)
      expect(
        rows
          .filter((row) => row.body.correlationId)
          .every((row) => row.headers["x-test"] === row.body.correlationId),
      ).toBe(true)
      await worker("close")
    },
    25_000,
  )

  it.each(["true"])(
    "preserves implicit queue consumption when the runner flag is %s",
    async (runner) => {
      const process = await startProcess(`test_${randomUUID()}_`, runner)
      await process("queue", {
        queue: "__wkf_step_test",
        body: { __healthCheck: true, correlationId: "normal" },
      })
      await expect
        .poll(() => process<Delivery[]>("snapshot"))
        .toEqual([
          expect.objectContaining({
            attempt: 1,
            body: { __healthCheck: true, correlationId: "normal" },
            url: "/.well-known/workflow/v1/step",
          }),
        ])
      await process("close")
    },
    10_000,
  )
})
