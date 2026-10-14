import { execFileSync } from "node:child_process"
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  chmod,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CodexLocalAccountError,
  createLocalCodexAccountReader,
} from "./codex-local-account"
import { preflightReport } from "../../scripts/check-precomputed-subscription"

const scratch: string[] = []
const now = () => Math.floor(Date.now() / 1_000)
const account = (planType = "pro", email = "operator@example.test") => ({
  account: { type: "chatgpt", email, planType },
  requiresOpenaiAuth: true,
})
const weekly = (usedPercent = 32) => ({
  usedPercent,
  windowDurationMins: 10_080,
  resetsAt: now() + 60 * 60,
})
const fiveHour = (usedPercent = 20) => ({
  usedPercent,
  windowDurationMins: 300,
  resetsAt: now() + 60 * 60,
})
const limits = (
  planType = "pro",
  primary: unknown = weekly(),
  secondary: unknown = null,
) => ({
  accountId: "backend-account-one",
  rateLimits: { primary: null },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      planType,
      primary,
      secondary,
      spendControlReached: false,
      rateLimitReachedType: null,
      credits: { hasCredits: true, unlimited: false },
    },
    codex_other: { primary: fiveHour(0), secondary: weekly(0) },
  },
})

type FakeConfig = {
  before?: unknown
  after?: unknown
  limits?: unknown
  limitsAfter?: unknown
  hangOn?: string
  oversized?: boolean
  heartbeat?: boolean
}

beforeEach(() => {
  vi.stubEnv("CI", "")
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function fakeServer(config: FakeConfig = {}) {
  const dir = await mkdtemp(join(tmpdir(), "forge-codex-account-test-"))
  scratch.push(dir)
  const executable = join(dir, "fake-codex.cjs")
  const capture = join(dir, "requests.jsonl")
  const heartbeat = join(dir, "heartbeat")
  const replies: Record<string, unknown> = {
    "2": config.before ?? account(),
    "3": config.limits ?? limits(),
    "4": config.after ?? account(),
    "5": config.limitsAfter ?? config.limits ?? limits(),
  }
  const script = `#!/usr/bin/env node
const fs = require("node:fs")
const { spawn } = require("node:child_process")
const readline = require("node:readline")
const capture = ${JSON.stringify(capture)}
const replies = ${JSON.stringify(replies)}
if (${config.heartbeat ?? false}) {
  spawn(process.execPath, ["-e", ${JSON.stringify(`const fs=require('node:fs'); setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20)`)}], {stdio:"ignore"})
}
readline.createInterface({input:process.stdin}).on("line", (line) => {
  const request = JSON.parse(line)
  fs.appendFileSync(capture, JSON.stringify({method:request.method,id:request.id,args:process.argv.slice(2),env:process.env,cwd:process.cwd()}) + "\\n")
  if (request.method === ${JSON.stringify(config.hangOn ?? "__none__")}) return
  if (${config.oversized ?? false} && request.id === 3) { process.stdout.write('x'.repeat(1100000)); return }
  const result = request.id === 1 ? {userAgent:"fake"} : replies[String(request.id)]
  if (request.id) process.stdout.write(JSON.stringify({id:request.id,result}) + "\\n")
})
`
  await writeFile(executable, script, { mode: 0o700 })
  await chmod(executable, 0o700)
  return { executable, capture, heartbeat }
}

async function requests(capture: string) {
  const data = await readFile(capture, "utf8")
  return data
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)) as Array<{
    method: string
    id?: number
    args: string[]
    env: Record<string, string>
    cwd: string
  }>
}

describe("read-only Codex account attestation", () => {
  it("uses only approved RPCs, exact codex bucket, backend ID binding, and no API environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-never-forward")
    vi.stubEnv("CODEX_ACCESS_TOKEN", "secret-never-forward")
    const fake = await fakeServer()
    const reader = createLocalCodexAccountReader({
      codexExecutable: fake.executable,
    })
    const result = await reader.readAttestation()
    expect(result.identity.accountRef).toMatch(/^[a-f0-9]{64}$/)
    expect(result.identity.accountRef).not.toContain("example")
    expect(result.plan).toBe("pro")
    expect(result.allowance.weeklyRemainingPercent).toBe(68)
    expect(result.allowance.fiveHour).toEqual({
      kind: "not_applicable",
      plan: "pro",
    })
    expect(result.admission).toBe("admitted")
    expect(preflightReport(result)).toEqual({
      accountRef: result.identity.accountRef,
      modelId: "gpt-6-astra",
      plan: "pro",
      weeklyRemainingPercent: 68,
      fiveHour: { kind: "not_applicable", plan: "pro" },
      admission: "admitted",
      billingBasis: "included_subscription",
      providerEnforcedIncludedOnlySpendCap: false,
    })
    const sent = await requests(fake.capture)
    expect(sent.map((item) => item.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
      "account/read",
      "account/rateLimits/read",
    ])
    expect(
      sent.every(
        (item) =>
          !item.method.includes("thread") && !item.method.includes("turn"),
      ),
    ).toBe(true)
    expect(sent[0]?.args).toContain('forced_login_method="chatgpt"')
    expect(sent[0]?.args).toContain('model_provider="openai"')
    expect(sent[0]?.env.OPENAI_API_KEY).toBeUndefined()
    expect(sent[0]?.env.CODEX_ACCESS_TOKEN).toBeUndefined()
    expect(sent[0]?.cwd).not.toBe(process.cwd())
  })

  it("reads a fresh backend identity every callback, including post-call", async () => {
    const fake = await fakeServer()
    const reader = createLocalCodexAccountReader({
      codexExecutable: fake.executable,
    })
    await reader.readOperatorIdentity()
    await reader.readAllowance()
    await reader.readOperatorIdentity()
    const sent = await requests(fake.capture)
    expect(sent.filter((item) => item.method === "initialize")).toHaveLength(3)
    expect(
      sent.filter((item) => item.method === "account/rateLimits/read"),
    ).toHaveLength(6)
  })

  it("runs the package preflight against only read-only RPCs and no inference", async () => {
    const fake = await fakeServer()
    await symlink(fake.executable, join(dirname(fake.executable), "codex"))
    const output = execFileSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        join(process.cwd(), "src/scripts/check-precomputed-subscription.ts"),
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          CI: "",
          PATH: `${dirname(fake.executable)}:${process.env.PATH}`,
        },
      },
    )
    expect(JSON.parse(output)).toMatchObject({
      modelId: "gpt-6-astra",
      admission: "admitted",
    })
    const sent = await requests(fake.capture)
    expect(sent.map((item) => item.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
      "account/read",
      "account/rateLimits/read",
    ])
  })

  it("classifies Plus using both actual windows and denies the 25% floor", async () => {
    const fake = await fakeServer({
      before: account("plus"),
      after: account("plus"),
      limits: limits("plus", fiveHour(75), weekly(20)),
    })
    const result = await createLocalCodexAccountReader({
      codexExecutable: fake.executable,
    }).readAttestation()
    expect(result.allowance.fiveHour).toEqual({
      kind: "limited",
      remainingPercent: 25,
    })
    expect(result.admission).toBe("insufficient")
  })

  it("uses the final meter if allowance falls during attestation", async () => {
    const fake = await fakeServer({
      limits: limits("pro", weekly(20)),
      limitsAfter: limits("pro", weekly(80)),
    })
    const result = await createLocalCodexAccountReader({
      codexExecutable: fake.executable,
    }).readAttestation()
    expect(result.allowance.weeklyRemainingPercent).toBe(20)
    expect(result.admission).toBe("insufficient")
  })

  it.each([
    [
      "api auth",
      { before: { account: { type: "apiKey" } } },
      "identity_unavailable",
    ],
    [
      "unknown plan",
      { before: account("enterprise"), after: account("enterprise") },
      "plan_unsupported",
    ],
    [
      "missing backend ID",
      { limits: { ...limits(), accountId: null } },
      "identity_unavailable",
    ],
    [
      "blank backend ID",
      { limits: { ...limits(), accountId: "  " } },
      "identity_unavailable",
    ],
    [
      "changed email",
      { after: account("pro", "other@example.test") },
      "identity_changed",
    ],
    [
      "changed backend ID",
      { limitsAfter: { ...limits(), accountId: "backend-account-two" } },
      "identity_changed",
    ],
    [
      "missing codex bucket",
      { limits: { ...limits(), rateLimitsByLimitId: { codex_other: {} } } },
      "allowance_unavailable",
    ],
    [
      "credit-only plan",
      {
        before: account("self_serve_business_usage_based"),
        after: account("self_serve_business_usage_based"),
      },
      "plan_unsupported",
    ],
    [
      "reached spend control",
      {
        limits: {
          ...limits(),
          rateLimitsByLimitId: {
            codex: {
              ...limits().rateLimitsByLimitId.codex,
              spendControlReached: true,
            },
          },
        },
      },
      "allowance_unavailable",
    ],
    [
      "expired weekly reset",
      { limits: limits("pro", { ...weekly(), resetsAt: now() - 1 }) },
      "allowance_unavailable",
    ],
    [
      "missing Plus five-hour meter",
      {
        before: account("plus"),
        after: account("plus"),
        limits: limits("plus"),
      },
      "allowance_unavailable",
    ],
  ] as const)("fails closed on %s", async (_name, config, code) => {
    const fake = await fakeServer(config)
    await expect(
      createLocalCodexAccountReader({
        codexExecutable: fake.executable,
      }).readAttestation(),
    ).rejects.toMatchObject({ code })
  })

  it("kills the owned process tree on timeout", async () => {
    const fake = await fakeServer({ hangOn: "account/read", heartbeat: true })
    await expect(
      createLocalCodexAccountReader({
        codexExecutable: fake.executable,
        timeoutMs: 250,
      }).readAttestation(),
    ).rejects.toMatchObject({ code: "rpc_timeout" })
    const before = (await readFile(fake.heartbeat, "utf8")).length
    await new Promise((resolve) => setTimeout(resolve, 100))
    const after = (await readFile(fake.heartbeat, "utf8")).length
    expect(after).toBe(before)
  })

  it("rejects oversized RPC output", async () => {
    const fake = await fakeServer({ oversized: true })
    await expect(
      createLocalCodexAccountReader({
        codexExecutable: fake.executable,
      }).readAttestation(),
    ).rejects.toMatchObject({ code: "rpc_oversized" })
  })

  it("keeps preflight local and requires an absolute executable", () => {
    expect(() =>
      createLocalCodexAccountReader({ codexExecutable: "codex" }),
    ).toThrow(CodexLocalAccountError)
    vi.stubEnv("CI", "1")
    expect(() =>
      createLocalCodexAccountReader({ codexExecutable: "/usr/bin/codex" }),
    ).toThrow(CodexLocalAccountError)
  })
})
