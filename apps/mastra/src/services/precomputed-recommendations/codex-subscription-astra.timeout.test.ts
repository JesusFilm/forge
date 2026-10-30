import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { createCodexSubscriptionAstraModel } from "./codex-subscription-astra"

const directories: string[] = []
beforeEach(() => vi.stubEnv("CI", ""))
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

function adapter(executable: string, timeoutMs?: number) {
  return createCodexSubscriptionAstraModel({
    codexExecutable: executable,
    initiatingAccountRef: "timeout-test-account",
    timeoutMs,
    readOperatorIdentity: async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "timeout-test-account",
      authMethod: "chatgpt",
    }),
    readAllowance: async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "timeout-test-account",
      billingBasis: "included_subscription",
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited", remainingPercent: 70 },
    }),
  })
}

async function waitingCli() {
  const directory = await mkdtemp(join(tmpdir(), "forge-astra-timeout-"))
  directories.push(directory)
  const executable = join(directory, "fake-codex.cjs")
  const started = join(directory, "started")
  const release = join(directory, "release")
  const events = [
    { type: "thread.started", thread_id: "timeout-test-thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify({ answer: "done" }) },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 30, cached_input_tokens: 4, output_tokens: 8 },
    },
  ]
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs")
fs.readFileSync(0, "utf8")
fs.writeFileSync(${JSON.stringify(started)}, "started")
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(release)})) return
  clearInterval(timer)
  fs.writeSync(1, ${JSON.stringify(events.map((event) => JSON.stringify(event)).join("\n") + "\n")})
  process.exit(0)
}, 5)
`,
    { mode: 0o700 },
  )
  return { executable, started, release }
}
const request = {
  schema: z.object({ answer: z.string() }),
  system: "Synthetic timeout test.",
  prompt: "Return the synthetic answer.",
  maxOutputTokens: 20,
}

describe("subscription transport bounded operator deadline", () => {
  it.each([0, -1, 0.5, 900_001, NaN, Infinity])(
    "rejects timeout %s before any invocation",
    (timeoutMs) => {
      expect(() => adapter("/unused/fake-codex", timeoutMs)).toThrow(
        "operator_only",
      )
    },
  )

  it.each([1, 300_001, 900_000])(
    "accepts explicit finite timeout %s",
    (timeoutMs) => {
      expect(() => adapter("/unused/fake-codex", timeoutMs)).not.toThrow()
    },
  )

  it("keeps the legacy 300000ms deadline and unknown consumption without retry", async () => {
    const cli = await waitingCli()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const model = adapter(cli.executable)
    const reserve = vi.fn(async () => ({
      kind: "dispatch" as const,
      reservation: 1,
    }))
    const settled = Promise.allSettled([
      model.generateReserved(request, reserve),
    ])
    try {
      await vi.waitFor(async () =>
        expect(await stat(cli.started)).toBeDefined(),
      )
      await vi.advanceTimersByTimeAsync(300_000)
      await expect(settled).resolves.toMatchObject([
        {
          status: "rejected",
          reason: { code: "provider_unavailable", consumptionUnknown: true },
        },
      ])
      expect((await settled)[0]).not.toHaveProperty("reason.usage.inputTokens")
      await expect(
        model.generateReserved(request, reserve),
      ).rejects.toMatchObject({
        code: "adapter_paused",
      })
      expect(reserve).toHaveBeenCalledTimes(1)
    } finally {
      await writeFile(cli.release, "release")
      await settled
    }
  })

  it("allows a metered result after the inherited five-minute cutoff", async () => {
    const cli = await waitingCli()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const result = Promise.allSettled([
      adapter(cli.executable, 900_000).generateReserved(request, async () => ({
        kind: "dispatch",
        reservation: 1,
      })),
    ])
    try {
      await vi.waitFor(async () =>
        expect(await stat(cli.started)).toBeDefined(),
      )
      await vi.advanceTimersByTimeAsync(300_001)
    } finally {
      await writeFile(cli.release, "release")
    }
    await expect(result).resolves.toMatchObject([
      {
        status: "fulfilled",
        value: {
          kind: "dispatched",
          response: { output: { answer: "done" }, usage: { inputTokens: 30 } },
        },
      },
    ])
  })

  it("still terminates at the explicit 900000ms maximum", async () => {
    const cli = await waitingCli()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    let finished = false
    const settled = Promise.allSettled([
      adapter(cli.executable, 900_000).generateReserved(request, async () => ({
        kind: "dispatch",
        reservation: 1,
      })),
    ]).then((results) => {
      finished = true
      return results
    })
    try {
      await vi.waitFor(async () =>
        expect(await stat(cli.started)).toBeDefined(),
      )
      await vi.advanceTimersByTimeAsync(899_999)
      expect(finished).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(settled).resolves.toMatchObject([
        {
          status: "rejected",
          reason: { code: "provider_unavailable", consumptionUnknown: true },
        },
      ])
      expect(await readFile(cli.started, "utf8")).toBe("started")
    } finally {
      await writeFile(cli.release, "release")
      await settled
    }
  })
})
