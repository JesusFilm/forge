import { mkdtemp, readFile, rm, writeFile, chmod, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createCodexSubscriptionAstraModel,
  type CodexAllowanceSnapshot,
  type CodexOperatorIdentitySnapshot,
} from "./codex-subscription-astra"
import {
  analyticsQueryPlanSchema,
  discoverySchema,
  summarySchema,
} from "./source-generation"
import { spanJudgmentSchema } from "./catalog-evidence-spans"

const scratch: string[] = []

beforeEach(() => {
  // These fake-process cases exercise a local operator invocation, even when
  // the test runner itself is hosted in CI. The separate CI test keeps the
  // production constructor guard observable.
  vi.stubEnv("CI", "")
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function fakeCli(
  events: unknown[],
  options: {
    exitCode?: number
    stderr?: string
    sleepMs?: number
    splitOnAccent?: boolean
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "forge-codex-astra-test-"))
  scratch.push(directory)
  const capture = join(directory, "capture.json")
  const executable = join(directory, "fake-codex.cjs")
  const script = `#!/usr/bin/env node
const fs = require("node:fs")
const capture = ${JSON.stringify(capture)}
const prompt = fs.readFileSync(0, "utf8")
const schemaPath = process.argv[process.argv.indexOf("--output-schema") + 1]
fs.writeFileSync(capture, JSON.stringify({ args: process.argv.slice(2), prompt, schema: JSON.parse(fs.readFileSync(schemaPath, "utf8")), cwd: process.cwd(), env: process.env }))
const eventBytes = Buffer.from(${JSON.stringify(events)}.map((event) => JSON.stringify(event)).join("\\n") + "\\n")
if (${options.splitOnAccent ?? false}) {
  const split = eventBytes.indexOf(Buffer.from("é")) + 1
  fs.writeSync(1, eventBytes.subarray(0, split))
  setTimeout(() => { fs.writeSync(1, eventBytes.subarray(split)); process.exit(${options.exitCode ?? 0}) }, 10)
} else {
  fs.writeSync(1, eventBytes)
  setTimeout(() => process.exit(${options.exitCode ?? 0}), ${options.sleepMs ?? 0})
}
process.stderr.write(${JSON.stringify(options.stderr ?? "")})
`
  await writeFile(executable, script, { mode: 0o700 })
  await chmod(executable, 0o700)
  return { executable, capture }
}

async function fakeNodeLauncher(eventsToEmit: unknown[]) {
  const directory = await mkdtemp(join(tmpdir(), "forge-codex-launcher-test-"))
  scratch.push(directory)
  const executable = join(directory, "wrapper.cjs")
  const heartbeat = join(directory, "native-heartbeat.txt")
  const nativeScript = `const fs = require("node:fs"); setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, "x"), 20); setTimeout(() => process.exit(0), 2200)`
  const wrapper = `#!/usr/bin/env node
const { spawn } = require("node:child_process")
const fs = require("node:fs")
fs.writeFileSync(${JSON.stringify(heartbeat)}, "")
spawn(process.execPath, ["-e", ${JSON.stringify(nativeScript)}], { stdio: ["ignore", "inherit", "inherit"] })
fs.readFileSync(0, "utf8")
for (const event of ${JSON.stringify(eventsToEmit)}) fs.writeSync(1, JSON.stringify(event) + "\\n")
setTimeout(() => process.exit(0), 2200)
`
  await writeFile(executable, wrapper, { mode: 0o700 })
  await chmod(executable, 0o700)
  return { executable, heartbeat }
}

function events(
  output: unknown,
  usage = { input_tokens: 30, cached_input_tokens: 4, output_tokens: 8 },
) {
  return [
    { type: "thread.started", thread_id: "test-thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "item_0",
        type: "agent_message",
        text: JSON.stringify(output),
      },
    },
    { type: "turn.completed", usage },
  ]
}

function model(
  executable: string,
  allowance: () => Promise<CodexAllowanceSnapshot> = async () => ({
    observedAt: new Date().toISOString(),
    accountRef: "initiating-account-123",
    billingBasis: "included_subscription" as const,
    weeklyRemainingPercent: 70,
    fiveHour: { kind: "limited" as const, remainingPercent: 60 },
  }),
  identity: () => Promise<CodexOperatorIdentitySnapshot> = async () => ({
    observedAt: new Date().toISOString(),
    accountRef: "initiating-account-123",
    authMethod: "chatgpt" as const,
  }),
  timeoutMs?: number,
) {
  return createCodexSubscriptionAstraModel({
    codexExecutable: executable,
    readAllowance: allowance,
    initiatingAccountRef: "initiating-account-123",
    readOperatorIdentity: identity,
    timeoutMs,
  })
}

const input = {
  schema: summarySchema,
  system: "Choose a summary.",
  prompt: "Untrusted transcript: a secret sentinel.",
  maxOutputTokens: 200,
}
const summary = {
  summaryEnglish:
    "This film follows a discussion about reconciliation and trust.",
}

describe("local ChatGPT-subscription Astra adapter", () => {
  it("uses the exact local Codex route and preserves usage without inventing a USD cost", async () => {
    const cli = await fakeCli(events(summary))
    const result = await model(cli.executable).generate(input)
    expect(result).toEqual({
      output: summary,
      usage: { inputTokens: 30, outputTokens: 8, cachedInputTokens: 4 },
    })

    const captured = JSON.parse(await readFile(cli.capture, "utf8"))
    expect(captured.args).toContain("gpt-6-astra")
    expect(captured.args).toContain("--ignore-user-config")
    expect(captured.args).toContain("--ephemeral")
    expect(captured.args).toContain("read-only")
    expect(captured.args).toContain('forced_login_method="chatgpt"')
    expect(captured.args).toContain('model_provider="openai"')
    expect(captured.args).toContain("features.shell_tool=false")
    expect(captured.args).toContain("features.unified_exec=false")
    expect(captured.args).toContain("features.apps=false")
    expect(captured.args.at(-1)).toBe("-")
    expect(captured.prompt).toContain(input.prompt)
    expect(captured.schema.properties.summaryEnglish.type).toBe("string")
    expect(captured.cwd.startsWith(join(tmpdir(), "forge-codex-astra-"))).toBe(
      true,
    )
    expect(captured.env.OPENAI_API_KEY).toBeUndefined()
    expect(captured.env.CODEX_API_KEY).toBeUndefined()
    expect(model(cli.executable).getOperatorProvenance()).toBeUndefined()
  })

  it("binds the invocation to the initiating signed-in ChatGPT account", async () => {
    const cli = await fakeCli(events(summary))
    const adapter = model(cli.executable)
    await adapter.generate(input)
    expect(adapter.getOperatorProvenance()).toMatchObject({
      accountRef: "initiating-account-123",
      authMethod: "chatgpt",
      allowanceAdmissionBasis: "included_subscription",
      execution: "manual_local_operator",
      modelId: "gpt-6-astra",
    })
  })

  it("rejects a different signed-in account before allowance admission or CLI execution", async () => {
    const cli = await fakeCli(events(summary))
    const allowance = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    }))
    const identity = async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "another-account",
      authMethod: "chatgpt" as const,
    })
    await expect(
      model(cli.executable, allowance, identity).generate(input),
    ).rejects.toMatchObject({ code: "identity_mismatch" })
    expect(allowance).not.toHaveBeenCalled()
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("fails closed when local identity cannot be freshly attested", async () => {
    const cli = await fakeCli(events(summary))
    await expect(
      model(cli.executable, undefined, async () => {
        throw new Error("private identity failure")
      }).generate(input),
    ).rejects.toMatchObject({ code: "identity_unavailable" })
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(
      model(cli.executable, undefined, async () => ({
        observedAt: "2020-01-01T00:00:00.000Z",
        accountRef: "initiating-account-123",
        authMethod: "chatgpt" as const,
      })).generate(input),
    ).rejects.toMatchObject({ code: "identity_stale" })
  })

  it("stops further calls if the signed-in account changes during an attempt", async () => {
    const cli = await fakeCli(events(summary))
    let accountRef = "initiating-account-123"
    const identity = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      accountRef,
      authMethod: "chatgpt" as const,
    }))
    const allowance = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    }))
    const adapter = model(cli.executable, allowance, identity)
    await adapter.generate(input)
    accountRef = "second-account-456"
    await expect(adapter.generate(input)).rejects.toMatchObject({
      code: "identity_mismatch",
    })
    expect(identity).toHaveBeenCalledTimes(3)
    expect(allowance).toHaveBeenCalledTimes(1)
    await expect(adapter.generate(input)).rejects.toMatchObject({
      code: "adapter_paused",
    })
  })

  it("rejects output if the account changed while the CLI was running, retaining usage", async () => {
    const cli = await fakeCli(events(summary))
    const identity = vi
      .fn()
      .mockResolvedValueOnce({
        observedAt: new Date().toISOString(),
        accountRef: "initiating-account-123",
        authMethod: "chatgpt",
      })
      .mockResolvedValueOnce({
        observedAt: new Date().toISOString(),
        accountRef: "second-account-456",
        authMethod: "chatgpt",
      })
    const adapter = model(cli.executable, undefined, identity)
    await expect(adapter.generate(input)).rejects.toMatchObject({
      code: "identity_mismatch",
      usage: { inputTokens: 30, outputTokens: 8 },
      consumptionUnknown: false,
    })
    expect(adapter.getOperatorProvenance()).toBeUndefined()
    expect(identity).toHaveBeenCalledTimes(2)
  })

  it("does not admit credit-only usage even with a positive remaining percentage", async () => {
    const cli = await fakeCli(events(summary))
    const creditOnly = async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "credit_only" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    })
    await expect(
      model(cli.executable, creditOnly).generate(input),
    ).rejects.toMatchObject({ code: "allowance_unavailable" })
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("rejects an allowance snapshot belonging to a different account", async () => {
    const cli = await fakeCli(events(summary))
    const anotherAccount = async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "second-account-456",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    })
    await expect(
      model(cli.executable, anotherAccount).generate(input),
    ).rejects.toMatchObject({ code: "allowance_unavailable" })
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("admits a Pro weekly-only snapshot when the five-hour window is explicitly not applicable", async () => {
    const cli = await fakeCli(events(summary))
    const proAllowance = async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "not_applicable" as const, plan: "pro" as const },
    })
    expect(
      (await model(cli.executable, proAllowance).generate(input)).output,
    ).toEqual(summary)
  })

  it("does not turn an unknown or null five-hour window into free headroom", async () => {
    const cli = await fakeCli(events(summary))
    for (const fiveHour of [
      null,
      { kind: "unknown" },
      { kind: "not_applicable", plan: "plus" },
    ]) {
      const unresolved: () => Promise<CodexAllowanceSnapshot> = async () =>
        ({
          observedAt: new Date().toISOString(),
          accountRef: "initiating-account-123",
          billingBasis: "included_subscription",
          weeklyRemainingPercent: 70,
          fiveHour,
        }) as unknown as CodexAllowanceSnapshot
      await expect(
        model(cli.executable, unresolved).generate(input),
      ).rejects.toMatchObject({ code: "allowance_unavailable" })
    }
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it.each([
    [
      "missing",
      async () => {
        throw new Error("secret quota-reader failure")
      },
      "allowance_unavailable",
    ],
    [
      "stale",
      async () => ({
        observedAt: "2020-01-01T00:00:00.000Z",
        accountRef: "initiating-account-123",
        billingBasis: "included_subscription" as const,
        weeklyRemainingPercent: 70,
        fiveHour: { kind: "limited" as const, remainingPercent: 60 },
      }),
      "allowance_stale",
    ],
    [
      "low weekly",
      async () => ({
        observedAt: new Date().toISOString(),
        accountRef: "initiating-account-123",
        billingBasis: "included_subscription" as const,
        weeklyRemainingPercent: 25,
        fiveHour: { kind: "limited" as const, remainingPercent: 60 },
      }),
      "allowance_insufficient",
    ],
    [
      "low five-hour",
      async () => ({
        observedAt: new Date().toISOString(),
        accountRef: "initiating-account-123",
        billingBasis: "included_subscription" as const,
        weeklyRemainingPercent: 70,
        fiveHour: { kind: "limited" as const, remainingPercent: 24 },
      }),
      "allowance_insufficient",
    ],
  ])(
    "rejects %s allowance before spawning",
    async (_label, allowance, code) => {
      const cli = await fakeCli(events(summary))
      await expect(
        model(cli.executable, allowance).generate(input),
      ).rejects.toMatchObject({ code })
      await expect(readFile(cli.capture)).rejects.toMatchObject({
        code: "ENOENT",
      })
    },
  )

  it("converts and independently validates all four current stage-shaped schemas", async () => {
    const cases = [
      [summarySchema, summary],
      [analyticsQueryPlanSchema, { candidateVideoIds: ["film-2"] }],
      [discoverySchema, { candidateVideoIds: ["film-3"] }],
      [
        spanJudgmentSchema,
        {
          connections: [
            {
              kind: "direct",
              relationship: "shared story",
              reasonEnglish: "Both films follow the same biblical account.",
              addedViewingValueEnglish: null,
              evidence: { basis: "metadata", fields: ["title"] },
              strength: 80,
            },
          ],
        },
      ],
    ] as const
    for (const [schema, output] of cases) {
      const cli = await fakeCli(events(output))
      expect(
        (
          await model(cli.executable).generate({
            schema,
            system: "Return JSON.",
            prompt: "Catalog data.",
            maxOutputTokens: 200,
          })
        ).output,
      ).toEqual(output)
      const captured = JSON.parse(await readFile(cli.capture, "utf8"))
      expect(captured.schema.type).toBe("object")
      expect(captured.schema.additionalProperties).toBe(false)
      if (schema === spanJudgmentSchema)
        expect(JSON.stringify(captured.schema)).toContain("anyOf")
    }
  })

  it("preserves UTF-8 text when JSONL arrives across a character boundary", async () => {
    const accented = {
      summaryEnglish: "This film discusses réconciliation between old friends.",
    }
    const cli = await fakeCli(events(accented), { splitOnAccent: true })
    expect((await model(cli.executable).generate(input)).output).toEqual(
      accented,
    )
  })

  it("rejects an invalid output limit before consuming allowance", async () => {
    const cli = await fakeCli(events(summary))
    const allowance = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    }))
    await expect(
      model(cli.executable, allowance).generate({
        ...input,
        maxOutputTokens: 0,
      }),
    ).rejects.toMatchObject({ code: "input_invalid" })
    expect(allowance).not.toHaveBeenCalled()
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("reads a new allowance snapshot for each successful call", async () => {
    const cli = await fakeCli(events(summary))
    const allowance = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    }))
    const adapter = model(cli.executable, allowance)
    await adapter.generate(input)
    await adapter.generate(input)
    expect(allowance).toHaveBeenCalledTimes(2)
  })

  it("rejects an unexpected tool event and never accepts its answer", async () => {
    const cli = await fakeCli([
      { type: "thread.started", thread_id: "test-thread" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "item_0",
          type: "command_execution",
          command: "cat ~/.codex/auth.json",
        },
      },
      ...events(summary).slice(2),
    ])
    await expect(model(cli.executable).generate(input)).rejects.toMatchObject({
      code: "unexpected_tool_event",
    })
  })

  it("rejects a message appended after the terminal usage event", async () => {
    const normal = events(summary)
    const cli = await fakeCli([normal[0], normal[1], normal[3], normal[2]])
    await expect(model(cli.executable).generate(input)).rejects.toMatchObject({
      code: "provider_invalid_output",
      usage: { inputTokens: 30, outputTokens: 8 },
    })
  })

  it("keeps reported usage on schema-invalid output without quoting transcript or stderr", async () => {
    const cli = await fakeCli(events({ summaryEnglish: "too short" }), {
      stderr: "secret stderr sentinel",
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(model(cli.executable).generate(input)).rejects.toMatchObject(
        {
          code: "provider_invalid_output",
          usage: { inputTokens: 30, outputTokens: 8, cachedInputTokens: 4 },
          consumptionUnknown: false,
        },
      )
      expect(log).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })

  it("flags missing terminal usage as unknown consumption", async () => {
    const cli = await fakeCli(events(summary).slice(0, -1))
    await expect(model(cli.executable).generate(input)).rejects.toMatchObject({
      code: "provider_invalid_output",
      consumptionUnknown: true,
    })
  })

  it("pauses queued calls after a failed or ambiguous invocation", async () => {
    const cli = await fakeCli(events({ summaryEnglish: "too short" }))
    const allowance = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "initiating-account-123",
      billingBasis: "included_subscription" as const,
      weeklyRemainingPercent: 70,
      fiveHour: { kind: "limited" as const, remainingPercent: 60 },
    }))
    const adapter = model(cli.executable, allowance)
    const first = adapter.generate(input)
    const second = adapter.generate(input)
    await expect(first).rejects.toMatchObject({
      code: "provider_invalid_output",
      usage: { inputTokens: 30 },
    })
    await expect(second).rejects.toMatchObject({
      code: "adapter_paused",
      usage: undefined,
    })
    expect(allowance).toHaveBeenCalledTimes(1)
  })

  it("preserves usage on nonzero exit and removes the isolated workspace", async () => {
    const cli = await fakeCli(events(summary), {
      exitCode: 1,
      stderr: "auth token secret",
    })
    const adapter = model(cli.executable)
    await expect(adapter.generate(input)).rejects.toMatchObject({
      code: "provider_unavailable",
      usage: { inputTokens: 30, outputTokens: 8 },
    })
    expect(adapter.getOperatorProvenance()).toBeUndefined()
    const captured = JSON.parse(await readFile(cli.capture, "utf8"))
    await expect(stat(captured.cwd)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("bounds output bytes and wall time", async () => {
    const oversized = await fakeCli(
      events({ summaryEnglish: "x".repeat(600_000) }),
    )
    await expect(
      model(oversized.executable).generate(input),
    ).rejects.toMatchObject({ code: "provider_unavailable" })
    const slow = await fakeCli(events(summary), { sleepMs: 1_000 })
    await expect(
      createCodexSubscriptionAstraModel({
        codexExecutable: slow.executable,
        initiatingAccountRef: "initiating-account-123",
        readOperatorIdentity: async () => ({
          observedAt: new Date().toISOString(),
          accountRef: "initiating-account-123",
          authMethod: "chatgpt",
        }),
        readAllowance: async () => ({
          observedAt: new Date().toISOString(),
          accountRef: "initiating-account-123",
          billingBasis: "included_subscription" as const,
          weeklyRemainingPercent: 70,
          fiveHour: { kind: "limited" as const, remainingPercent: 60 },
        }),
        timeoutMs: 100,
      }).generate(input),
    ).rejects.toMatchObject({ code: "provider_unavailable" })
  })

  it.each(["timeout", "tool_event"] as const)(
    "terminates the owned wrapper and native child on %s",
    async (mode) => {
      const emitted =
        mode === "tool_event"
          ? [
              { type: "thread.started", thread_id: "test-thread" },
              { type: "turn.started" },
              { type: "item.completed", item: { type: "command_execution" } },
            ]
          : [{ type: "thread.started", thread_id: "test-thread" }]
      const launcher = await fakeNodeLauncher(emitted)
      const started = Date.now()
      await expect(
        model(launcher.executable, undefined, undefined, 100).generate(input),
      ).rejects.toMatchObject({
        code:
          mode === "tool_event"
            ? "unexpected_tool_event"
            : "provider_unavailable",
        consumptionUnknown: true,
      })
      expect(Date.now() - started).toBeLessThan(900)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const before = await readFile(launcher.heartbeat, "utf8")
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(await readFile(launcher.heartbeat, "utf8")).toBe(before)
    },
  )

  it("excludes paid API credentials and config overrides from the child", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-openai")
    vi.stubEnv("CODEX_API_KEY", "secret-codex")
    vi.stubEnv("OPENAI_BASE_URL", "https://paid.example.invalid")
    const cli = await fakeCli(events(summary))
    await model(cli.executable).generate(input)
    const captured = JSON.parse(await readFile(cli.capture, "utf8"))
    expect(captured.env.OPENAI_API_KEY).toBeUndefined()
    expect(captured.env.CODEX_API_KEY).toBeUndefined()
    expect(captured.env.OPENAI_BASE_URL).toBeUndefined()
    expect(captured.args).toContain('forced_login_method="chatgpt"')
    expect(captured.args).toContain('model_provider="openai"')
  })

  it("refuses construction in a hosted runtime", async () => {
    const cli = await fakeCli(events(summary))
    vi.stubEnv("RAILWAY_ENVIRONMENT", "production")
    expect(() => model(cli.executable)).toThrowError("operator_only")
  })

  it("refuses construction when the actual invocation is in CI", async () => {
    const cli = await fakeCli(events(summary))
    vi.stubEnv("CI", "true")
    expect(() => model(cli.executable)).toThrowError("operator_only")
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})
