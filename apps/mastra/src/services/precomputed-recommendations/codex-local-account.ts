import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { StringDecoder } from "node:string_decoder"

import { PRECOMPUTED_MODEL_ID } from "./astra-provider"
import type {
  CodexAllowanceSnapshot,
  CodexOperatorIdentitySnapshot,
} from "./codex-subscription-astra"

const MAX_RESPONSE_BYTES = 1_048_576
const DEFAULT_TIMEOUT_MS = 30_000
const MIN_REMAINING_PERCENT = 25
const WEEK_MINUTES = 10_080
const FIVE_HOURS_MINUTES = 300

type RpcMethod = "initialize" | "account/read" | "account/rateLimits/read"
type JsonObject = Record<string, unknown>

export class CodexLocalAccountError extends Error {
  constructor(
    readonly code:
      | "operator_only"
      | "rpc_unavailable"
      | "rpc_timeout"
      | "rpc_oversized"
      | "rpc_invalid"
      | "identity_unavailable"
      | "identity_changed"
      | "allowance_unavailable"
      | "plan_unsupported",
  ) {
    super(code)
    this.name = "CodexLocalAccountError"
  }
}

export type CodexAccountAttestation = {
  identity: CodexOperatorIdentitySnapshot
  allowance: CodexAllowanceSnapshot
  modelId: typeof PRECOMPUTED_MODEL_ID
  plan: "pro" | "plus"
  admission: "admitted" | "insufficient"
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function childEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NO_COLOR: "1" }
  for (const key of [
    "HOME",
    "CODEX_HOME",
    "PATH",
    "USER",
    "LANG",
    "LC_ALL",
    "TERM",
  ] as const) {
    const value = process.env[key]
    if (value) result[key] = value
  }
  return result
}

function terminateGroup(child: ChildProcess): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL")
      return
    } catch {
      // The process group may have already exited.
    }
  }
  child.kill("SIGKILL")
}

async function readRpc(
  executable: string,
  timeoutMs: number,
): Promise<{
  before: unknown
  rateLimits: unknown
  after: unknown
  rateLimitsAfter: unknown
}> {
  const directory = await mkdtemp(join(tmpdir(), "forge-codex-account-"))
  let child: ChildProcess | undefined
  try {
    child = spawn(
      executable,
      [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        'forced_login_method="chatgpt"',
        "-c",
        'model_provider="openai"',
        "-c",
        'web_search="disabled"',
        "-c",
        "features.apps=false",
        "-c",
        "project_doc_max_bytes=0",
      ],
      {
        cwd: directory,
        env: childEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        detached: true,
      },
    )
    const runningChild = child
    let bytes = 0
    let buffer = ""
    const decoder = new StringDecoder("utf8")
    let pending:
      | {
          id: number
          resolve: (value: unknown) => void
          reject: (error: CodexLocalAccountError) => void
        }
      | undefined
    let failure: CodexLocalAccountError | undefined
    const fail = (code: CodexLocalAccountError["code"]) => {
      if (failure) return
      failure = new CodexLocalAccountError(code)
      pending?.reject(failure)
      pending = undefined
      terminateGroup(runningChild)
    }
    const onBytes = (chunk: Buffer, parse: boolean) => {
      bytes += chunk.length
      if (bytes > MAX_RESPONSE_BYTES) {
        fail("rpc_oversized")
        return
      }
      if (!parse || failure) return
      buffer += decoder.write(chunk)
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line) {
          let message: unknown
          try {
            message = JSON.parse(line)
          } catch {
            fail("rpc_invalid")
            return
          }
          const rpc = object(message)
          if (!rpc) {
            fail("rpc_invalid")
            return
          }
          if ("id" in rpc) {
            if (
              !pending ||
              rpc.id !== pending.id ||
              "error" in rpc ||
              !("result" in rpc)
            ) {
              fail("rpc_invalid")
              return
            }
            const current = pending
            pending = undefined
            current.resolve(rpc.result)
          } else if (typeof rpc.method !== "string") {
            fail("rpc_invalid")
            return
          }
        }
        newline = buffer.indexOf("\n")
      }
    }
    runningChild.stdout?.on("data", (chunk: Buffer) => onBytes(chunk, true))
    // Stderr may contain account details. Count and discard it, never log it.
    runningChild.stderr?.on("data", (chunk: Buffer) => onBytes(chunk, false))
    runningChild.stdin?.on("error", () => fail("rpc_unavailable"))
    runningChild.on("error", () => fail("rpc_unavailable"))
    const closed = new Promise<void>((resolve) => {
      runningChild.on("close", () => {
        if (!failure) fail("rpc_unavailable")
        resolve()
      })
    })
    const overallTimer = setTimeout(() => fail("rpc_timeout"), timeoutMs)
    const request = (id: number, method: RpcMethod, params?: JsonObject) => {
      if (failure) throw failure
      if (pending) throw new CodexLocalAccountError("rpc_invalid")
      return new Promise<unknown>((resolve, reject) => {
        pending = { id, resolve, reject }
        const payload = JSON.stringify({ id, method, params }) + "\n"
        runningChild.stdin?.write(payload)
      })
    }
    try {
      const initialized = await request(1, "initialize", {
        clientInfo: {
          name: "forge_recommendation_operator_check",
          title: "Forge recommendation operator read-only check",
          version: "0.1.0",
        },
      })
      if (!object(initialized)) throw new CodexLocalAccountError("rpc_invalid")
      runningChild.stdin?.write(
        JSON.stringify({ method: "initialized" }) + "\n",
      )
      const before = await request(2, "account/read", { refreshToken: false })
      const rateLimits = await request(3, "account/rateLimits/read")
      const after = await request(4, "account/read", { refreshToken: false })
      // account/read has no backend account ID. A second metering read
      // prevents two same-email workspaces from sharing a binding if the
      // active backend account switches during this attestation.
      const rateLimitsAfter = await request(5, "account/rateLimits/read")
      return { before, rateLimits, after, rateLimitsAfter }
    } finally {
      clearTimeout(overallTimer)
      terminateGroup(runningChild)
      let cleanupTimer: NodeJS.Timeout | undefined
      await Promise.race([
        closed,
        new Promise((resolve) => {
          cleanupTimer = setTimeout(resolve, 2_000)
        }),
      ])
      clearTimeout(cleanupTimer)
    }
  } finally {
    if (child) terminateGroup(child)
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

function account(value: unknown): {
  plan: "pro" | "plus"
  email: string | null
} {
  const response = object(value)
  const raw = object(response?.account)
  if (
    raw?.type !== "chatgpt" ||
    (typeof raw.email !== "string" && raw.email !== null)
  )
    throw new CodexLocalAccountError("identity_unavailable")
  if (raw.planType !== "pro" && raw.planType !== "plus")
    throw new CodexLocalAccountError("plan_unsupported")
  return { plan: raw.planType, email: raw.email }
}

function window(value: unknown, minutes: number, nowSeconds: number): number {
  const raw = object(value)
  const used = raw?.usedPercent
  const duration = raw?.windowDurationMins
  const reset = raw?.resetsAt
  if (
    !Number.isSafeInteger(used) ||
    Number(used) < 0 ||
    Number(used) > 100 ||
    duration !== minutes ||
    !Number.isSafeInteger(reset) ||
    Number(reset) <= nowSeconds ||
    Number(reset) > nowSeconds + minutes * 60 + 300
  )
    throw new CodexLocalAccountError("allowance_unavailable")
  return 100 - Number(used)
}

function decode(
  beforeValue: unknown,
  limitsValue: unknown,
  afterValue: unknown,
  limitsAfterValue: unknown,
): CodexAccountAttestation {
  const before = account(beforeValue)
  const after = account(afterValue)
  if (before.plan !== after.plan || before.email !== after.email)
    throw new CodexLocalAccountError("identity_changed")
  const accountId = object(limitsValue)?.accountId
  const limits = object(limitsAfterValue)
  const accountIdAfter = limits?.accountId
  if (
    typeof accountId !== "string" ||
    !accountId.trim() ||
    accountId.length > 256
  )
    throw new CodexLocalAccountError("identity_unavailable")
  if (accountIdAfter !== accountId)
    throw new CodexLocalAccountError("identity_changed")
  // Only the named ordinary Codex bucket qualifies. Aggregate or credit-only
  // snapshots can otherwise appear to have allowance for a different product.
  const buckets = object(limits?.rateLimitsByLimitId)
  const bucket = object(buckets?.codex)
  if (
    !bucket ||
    (bucket.limitId !== undefined &&
      bucket.limitId !== null &&
      bucket.limitId !== "codex") ||
    bucket.planType !== before.plan ||
    bucket.spendControlReached !== false ||
    bucket.rateLimitReachedType !== null
  )
    throw new CodexLocalAccountError("allowance_unavailable")
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const windows = [bucket.primary, bucket.secondary].filter(
    (item) => item != null,
  )
  const weekly = windows.filter(
    (item) => object(item)?.windowDurationMins === WEEK_MINUTES,
  )
  const fiveHour = windows.filter(
    (item) => object(item)?.windowDurationMins === FIVE_HOURS_MINUTES,
  )
  if (
    weekly.length !== 1 ||
    (before.plan === "pro"
      ? windows.length !== 1 || fiveHour.length !== 0
      : windows.length !== 2 || fiveHour.length !== 1)
  )
    throw new CodexLocalAccountError("allowance_unavailable")
  const weeklyRemainingPercent = window(weekly[0], WEEK_MINUTES, nowSeconds)
  const fiveHourSnapshot: CodexAllowanceSnapshot["fiveHour"] =
    before.plan === "pro"
      ? { kind: "not_applicable", plan: "pro" }
      : {
          kind: "limited",
          remainingPercent: window(fiveHour[0], FIVE_HOURS_MINUTES, nowSeconds),
        }
  const accountRef = createHash("sha256")
    .update("forge-codex-account-v1:")
    .update(accountId)
    .digest("hex")
  const observedAt = new Date().toISOString()
  const allowance: CodexAllowanceSnapshot = {
    observedAt,
    accountRef,
    billingBasis: "included_subscription",
    weeklyRemainingPercent,
    fiveHour: fiveHourSnapshot,
  }
  return {
    identity: { observedAt, accountRef, authMethod: "chatgpt" },
    allowance,
    modelId: PRECOMPUTED_MODEL_ID,
    plan: before.plan,
    admission:
      weeklyRemainingPercent > MIN_REMAINING_PERCENT &&
      (fiveHourSnapshot.kind === "not_applicable" ||
        fiveHourSnapshot.remainingPercent > MIN_REMAINING_PERCENT)
        ? "admitted"
        : "insufficient",
  }
}

export function createLocalCodexAccountReader(options: {
  codexExecutable: string
  timeoutMs?: number
}): {
  readAttestation: () => Promise<CodexAccountAttestation>
  readOperatorIdentity: () => Promise<CodexOperatorIdentitySnapshot>
  readAllowance: () => Promise<CodexAllowanceSnapshot>
} {
  if (
    process.platform === "win32" ||
    !isAbsolute(options.codexExecutable) ||
    process.env.CI ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_SERVICE_ID
  )
    throw new CodexLocalAccountError("operator_only")
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45_000)
    throw new CodexLocalAccountError("operator_only")
  const readAttestation = async () => {
    const result = await readRpc(options.codexExecutable, timeoutMs)
    return decode(
      result.before,
      result.rateLimits,
      result.after,
      result.rateLimitsAfter,
    )
  }
  // Each callback performs a fresh backend read, including the model adapter's
  // post-call identity check. No app-server auth snapshot survives a call.
  return {
    readAttestation,
    readOperatorIdentity: async () => (await readAttestation()).identity,
    readAllowance: async () => (await readAttestation()).allowance,
  }
}
