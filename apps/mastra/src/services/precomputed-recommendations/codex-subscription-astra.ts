import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { StringDecoder } from "node:string_decoder"

import { z } from "zod"

import {
  PRECOMPUTED_MODEL_ID,
  type ModelUsage,
  type StructuredModel,
} from "./astra-provider"

const MAX_PROMPT_BYTES = 2_000_000
const MAX_EVENT_BYTES = 512_000
const MAX_SCHEMA_BYTES = 128_000
const MAX_EVENT_COUNT = 256
const MAX_ALLOWANCE_AGE_MS = 60_000
const DEFAULT_TIMEOUT_MS = 180_000
const MIN_REMAINING_PERCENT = 25

export type CodexAllowanceSnapshot = {
  observedAt: string
  /** Same opaque backend account binding as the local identity attestation. */
  accountRef: string
  /** Must be independently attested; ChatGPT auth or available credits do not prove it. */
  billingBasis: "included_subscription" | "credit_only" | "unknown"
  weeklyRemainingPercent: number
  fiveHour:
    | { kind: "limited"; remainingPercent: number }
    | { kind: "not_applicable"; plan: "pro" }
}

export type CodexOperatorIdentitySnapshot = {
  observedAt: string
  /** Trusted reader supplies a non-secret, opaque account binding, never email or auth tokens. */
  accountRef: string
  authMethod: "chatgpt"
}

export type CodexOperatorProvenance = {
  accountRef: string
  authMethod: "chatgpt"
  allowanceAdmissionBasis: "included_subscription"
  execution: "manual_local_operator"
  modelId: string
}

export type CodexSubscriptionAstraModel = StructuredModel & {
  /** Current verified binding; absent after identity reattestation fails. */
  getOperatorProvenance(): CodexOperatorProvenance | undefined
}

export class CodexSubscriptionAstraError extends Error {
  readonly usage?: ModelUsage
  readonly consumptionUnknown: boolean

  constructor(
    readonly code:
      | "operator_only"
      | "identity_unavailable"
      | "identity_stale"
      | "identity_mismatch"
      | "allowance_unavailable"
      | "allowance_stale"
      | "allowance_insufficient"
      | "adapter_paused"
      | "schema_unsupported"
      | "input_invalid"
      | "input_too_large"
      | "provider_invalid_output"
      | "provider_unavailable"
      | "unexpected_tool_event",
    options: { usage?: ModelUsage; consumptionUnknown?: boolean } = {},
  ) {
    super(code)
    this.name = "CodexSubscriptionAstraError"
    this.usage = options.usage
    this.consumptionUnknown = options.consumptionUnknown ?? false
  }
}

type Options = {
  /** Absolute path to the locally installed Codex CLI. Never used by server routes. */
  codexExecutable: string
  /** Non-secret account binding supplied by the initiating local operator. */
  initiatingAccountRef: string
  /** Trusted local identity attestation; browser/Admin identity alone is insufficient. */
  readOperatorIdentity: () => Promise<CodexOperatorIdentitySnapshot>
  /** A live, injected account meter read. No undocumented CLI quota scraping. */
  readAllowance: () => Promise<CodexAllowanceSnapshot>
  timeoutMs?: number
}

function percent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100
}

function fresh(observedAt: string): boolean {
  const age = Date.now() - Date.parse(observedAt)
  return Number.isFinite(age) && age >= 0 && age <= MAX_ALLOWANCE_AGE_MS
}

async function requireIdentity(
  options: Options,
): Promise<Omit<CodexOperatorProvenance, "allowanceAdmissionBasis">> {
  let identity: CodexOperatorIdentitySnapshot
  try {
    identity = await options.readOperatorIdentity()
  } catch {
    throw new CodexSubscriptionAstraError("identity_unavailable")
  }
  if (
    !identity ||
    identity.authMethod !== "chatgpt" ||
    typeof identity.accountRef !== "string" ||
    !/^[A-Za-z0-9:_-]{8,128}$/u.test(identity.accountRef)
  )
    throw new CodexSubscriptionAstraError("identity_unavailable")
  if (!fresh(identity.observedAt))
    throw new CodexSubscriptionAstraError("identity_stale")
  if (identity.accountRef !== options.initiatingAccountRef)
    throw new CodexSubscriptionAstraError("identity_mismatch")
  return {
    accountRef: identity.accountRef,
    authMethod: "chatgpt",
    execution: "manual_local_operator",
    modelId: PRECOMPUTED_MODEL_ID,
  }
}

async function requireAllowance(
  read: Options["readAllowance"],
  accountRef: string,
): Promise<void> {
  let snapshot: CodexAllowanceSnapshot
  try {
    snapshot = await read()
  } catch {
    throw new CodexSubscriptionAstraError("allowance_unavailable")
  }
  if (
    !snapshot ||
    snapshot.accountRef !== accountRef ||
    snapshot.billingBasis !== "included_subscription" ||
    !percent(snapshot.weeklyRemainingPercent)
  )
    throw new CodexSubscriptionAstraError("allowance_unavailable")
  const fiveHour = snapshot.fiveHour
  if (
    !fiveHour ||
    (fiveHour.kind === "limited"
      ? !percent(fiveHour.remainingPercent)
      : fiveHour.kind !== "not_applicable" || fiveHour.plan !== "pro")
  )
    throw new CodexSubscriptionAstraError("allowance_unavailable")
  if (!fresh(snapshot.observedAt))
    throw new CodexSubscriptionAstraError("allowance_stale")
  if (
    snapshot.weeklyRemainingPercent <= MIN_REMAINING_PERCENT ||
    (fiveHour.kind === "limited" &&
      fiveHour.remainingPercent <= MIN_REMAINING_PERCENT)
  )
    throw new CodexSubscriptionAstraError("allowance_insufficient")
}

function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME",
    "CODEX_HOME",
    "PATH",
    "USER",
    "LANG",
    "LC_ALL",
    "TERM",
  ] as const
  const result: NodeJS.ProcessEnv = { NO_COLOR: "1" }
  for (const key of allowed) {
    const value = process.env[key]
    if (value) result[key] = value
  }
  return result
}

function token(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined
}

type CodexEvents = {
  output?: string
  usage?: ModelUsage
  phase: "initial" | "thread" | "turn" | "completed"
  failed?:
    | "provider_invalid_output"
    | "provider_unavailable"
    | "unexpected_tool_event"
}

function processEvent(raw: string, state: CodexEvents): void {
  let event: unknown
  try {
    event = JSON.parse(raw)
  } catch {
    state.failed ??= "provider_invalid_output"
    return
  }
  if (typeof event !== "object" || !event || !("type" in event)) {
    state.failed ??= "provider_invalid_output"
    return
  }
  const item = event as {
    type: unknown
    item?: { type?: unknown; text?: unknown }
    usage?: Record<string, unknown>
  }
  if (item.type === "thread.started") {
    if (state.phase !== "initial") state.failed ??= "provider_invalid_output"
    else state.phase = "thread"
    return
  }
  if (item.type === "turn.started") {
    if (state.phase !== "thread") state.failed ??= "provider_invalid_output"
    else state.phase = "turn"
    return
  }
  if (item.type === "item.completed") {
    if (item.item?.type !== "agent_message") {
      state.failed ??= "unexpected_tool_event"
      return
    }
    if (
      state.phase !== "turn" ||
      state.output !== undefined ||
      typeof item.item.text !== "string"
    ) {
      state.failed ??= "provider_invalid_output"
      return
    }
    state.output = item.item.text
    return
  }
  if (item.type === "turn.completed") {
    const inputTokens = token(item.usage?.input_tokens)
    const outputTokens = token(item.usage?.output_tokens)
    if (
      state.phase !== "turn" ||
      inputTokens === undefined ||
      outputTokens === undefined
    ) {
      state.failed ??= "provider_invalid_output"
      return
    }
    state.usage = {
      inputTokens,
      outputTokens,
      cachedInputTokens: token(item.usage?.cached_input_tokens),
    }
    if (state.usage.cachedInputTokens === undefined)
      delete state.usage.cachedInputTokens
    state.phase = "completed"
    return
  }
  state.failed ??=
    item.type === "turn.failed"
      ? "provider_unavailable"
      : "unexpected_tool_event"
}

async function runCodex(input: {
  executable: string
  schema: unknown
  prompt: string
  timeoutMs: number
}): Promise<{ output: string; usage: ModelUsage }> {
  const directory = await mkdtemp(join(tmpdir(), "forge-codex-astra-"))
  try {
    const schemaPath = join(directory, "output-schema.json")
    await writeFile(schemaPath, JSON.stringify(input.schema), { mode: 0o600 })
    const args = [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      PRECOMPUTED_MODEL_ID,
      "--json",
      "--output-schema",
      schemaPath,
      "-C",
      directory,
      "-c",
      'forced_login_method="chatgpt"',
      "-c",
      'model_provider="openai"',
      "-c",
      'web_search="disabled"',
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.unified_exec=false",
      "-c",
      "features.apps=false",
      "-c",
      "project_doc_max_bytes=0",
      "-",
    ]
    const state: CodexEvents = { phase: "initial" }
    let bytes = 0
    let lines = 0
    let remainder = ""
    const decoder = new StringDecoder("utf8")
    let timedOut = false
    let oversized = false
    let spawnFailed = false
    const child = spawn(input.executable, args, {
      cwd: directory,
      env: childEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, input.timeoutMs)
    child.stdin.on("error", () => {})
    child.stdin.end(input.prompt)
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_EVENT_BYTES) {
        oversized = true
        child.kill("SIGKILL")
        return
      }
      remainder += decoder.write(chunk)
      let newline = remainder.indexOf("\n")
      while (newline !== -1) {
        const line = remainder.slice(0, newline)
        remainder = remainder.slice(newline + 1)
        if (++lines > MAX_EVENT_COUNT) {
          oversized = true
          child.kill("SIGKILL")
          return
        }
        if (line) processEvent(line, state)
        if (state.failed === "unexpected_tool_event") child.kill("SIGKILL")
        newline = remainder.indexOf("\n")
      }
    })
    // Stderr may include catalog text or credentials. Drain it but never retain it.
    child.stderr.on("data", () => {})
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("error", () => {
        spawnFailed = true
      })
      child.on("close", resolve)
    })
    clearTimeout(timer)
    remainder += decoder.end()
    if (remainder && !oversized) processEvent(remainder, state)
    const usage = state.usage
    const unknown = usage === undefined
    if (state.failed)
      throw new CodexSubscriptionAstraError(state.failed, {
        usage,
        consumptionUnknown: unknown,
      })
    if (timedOut || oversized || spawnFailed || exitCode !== 0)
      throw new CodexSubscriptionAstraError("provider_unavailable", {
        usage,
        consumptionUnknown: unknown,
      })
    if (state.phase !== "completed" || !state.output || !usage)
      throw new CodexSubscriptionAstraError("provider_invalid_output", {
        usage,
        consumptionUnknown: unknown,
      })
    return { output: state.output, usage }
  } finally {
    // A cleanup failure must not replace a potentially charged call's usage.
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

/** Explicitly constructed by a local operator; never imported by a service route. */
export function createCodexSubscriptionAstraModel(
  options: Options,
): CodexSubscriptionAstraModel {
  if (
    !isAbsolute(options.codexExecutable) ||
    !/^[A-Za-z0-9:_-]{8,128}$/u.test(options.initiatingAccountRef) ||
    process.env.CI ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_SERVICE_ID
  )
    throw new CodexSubscriptionAstraError("operator_only")
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new CodexSubscriptionAstraError("operator_only")
  let tail: Promise<unknown> = Promise.resolve()
  let paused = false
  let provenance: CodexOperatorProvenance | undefined
  return {
    getOperatorProvenance: () => provenance && { ...provenance },
    generate<T extends z.ZodType>(request: {
      schema: T
      system: string
      prompt: string
      maxOutputTokens: number
    }): Promise<{ output: z.output<T>; usage: ModelUsage }> {
      const task = tail.then(async () => {
        if (paused) throw new CodexSubscriptionAstraError("adapter_paused")
        if (
          !Number.isSafeInteger(request.maxOutputTokens) ||
          request.maxOutputTokens < 1 ||
          typeof request.system !== "string" ||
          typeof request.prompt !== "string"
        )
          throw new CodexSubscriptionAstraError("input_invalid")
        const identity = await requireIdentity(options)
        await requireAllowance(options.readAllowance, identity.accountRef)
        provenance = {
          ...identity,
          allowanceAdmissionBasis: "included_subscription",
        }
        let schema: unknown
        try {
          schema = z.toJSONSchema(request.schema, {
            target: "draft-07",
            unrepresentable: "throw",
          })
        } catch {
          throw new CodexSubscriptionAstraError("schema_unsupported")
        }
        if (
          Buffer.byteLength(JSON.stringify(schema), "utf8") > MAX_SCHEMA_BYTES
        )
          throw new CodexSubscriptionAstraError("schema_unsupported")
        const prompt = JSON.stringify({
          instructions: request.system,
          untrustedCatalogData: request.prompt,
          response:
            "Return only the JSON object required by the provided output schema. Do not call tools.",
        })
        if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES)
          throw new CodexSubscriptionAstraError("input_too_large")
        let response: { output: string; usage: ModelUsage }
        try {
          response = await runCodex({
            executable: options.codexExecutable,
            schema,
            prompt,
            timeoutMs,
          })
        } catch (error) {
          provenance = undefined
          if (error instanceof CodexSubscriptionAstraError) throw error
          throw new CodexSubscriptionAstraError("provider_unavailable", {
            consumptionUnknown: true,
          })
        }
        try {
          await requireIdentity(options)
        } catch (error) {
          provenance = undefined
          throw new CodexSubscriptionAstraError(
            error instanceof CodexSubscriptionAstraError
              ? error.code
              : "identity_unavailable",
            { usage: response.usage },
          )
        }
        if (
          response.usage.outputTokens !== undefined &&
          response.usage.outputTokens > request.maxOutputTokens
        )
          throw new CodexSubscriptionAstraError("provider_invalid_output", {
            usage: response.usage,
          })
        let parsed: unknown
        try {
          parsed = JSON.parse(response.output)
          return { output: request.schema.parse(parsed), usage: response.usage }
        } catch {
          throw new CodexSubscriptionAstraError("provider_invalid_output", {
            usage: response.usage,
          })
        }
      })
      tail = task.catch(() => {
        paused = true
      })
      return task
    },
  }
}
