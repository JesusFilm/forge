/**
 * Claude Code CLI adapter for the Experience AI chat surface.
 *
 * Peer of `experience-ai-codex.ts`. Spawns the local `claude` binary in
 * `--print` mode with `--output-format stream-json` so we receive each
 * assistant turn as an NDJSON frame and a final `result` frame that
 * carries the validated structured output.
 *
 * CLI invocation:
 *   claude --print --output-format stream-json --verbose \
 *          --json-schema '<inline-json>' --model <model>
 *
 * `--verbose` is required by Claude Code when `--output-format` is
 * `stream-json`. The schema is passed inline (no temp file) which is
 * simpler than Codex's file-based path; we still re-validate with Zod
 * on the return.
 *
 * Two flows, one spawn helper. The gate (`isClaudeCodeAllowed()`) is
 * checked BEFORE spawn so an env that hasn't opted in returns
 * `provider_not_configured` cleanly without an ENOENT race.
 *
 * Note: Claude Code's stream-json emits per-message frames, not per-
 * token deltas (unless `--include-partial-messages` is set, which we
 * skip to keep parsing simple). The `onToken` callback receives each
 * assistant message's text content as it arrives — coarser-grained
 * than Codex's raw-line streaming, but the editor still sees progress.
 */

import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process"
import type { Readable, Writable } from "node:stream"

import { env } from "@/config/env"

import type { ChatErrorCode } from "./experience-ai-chat-error-codes"
import { isClaudeCodeAllowed } from "./experience-ai-cli-gates"

const DEFAULT_CLAUDE_CODE_MODEL = "sonnet"

export const CLAUDE_CODE_TOTAL_TIMEOUT_MS = 180_000
export const CLAUDE_CODE_IDLE_TIMEOUT_MS = 120_000

export type ClaudeCodeProviderAttempt = {
  model: string
  status: "succeeded" | "failed"
  usedModel?: string
  reason?: string
}

export type ClaudeCodeStructuredResult<T> = {
  payload: T
  model: string
  usedModel: string
  attempts: ClaudeCodeProviderAttempt[]
}

export type ClaudeCodeProviderErrorCode =
  | "missing_provider"
  | "upstream_error"
  | "validation_error"
  | "timeout"

export class ClaudeCodeProviderError extends Error {
  constructor(
    readonly code: ClaudeCodeProviderErrorCode,
    message: string,
    readonly attempts: ClaudeCodeProviderAttempt[] = [],
  ) {
    super(message)
    this.name = "ClaudeCodeProviderError"
  }
}

export type ClaudeCodeRunResult =
  | { kind: "envelope"; raw: unknown }
  | { kind: "error"; code: ChatErrorCode; message: string }

export function claudeCodeChatModel(): string {
  return env.EXPERIENCE_AI_CLAUDE_CODE_MODEL ?? DEFAULT_CLAUDE_CODE_MODEL
}

type ClaudeCodeProcess = ChildProcessByStdio<Writable, Readable, Readable>

type StreamFrame = {
  type?: string
  subtype?: string
  result?: unknown
  is_error?: boolean
  message?: {
    content?: Array<{
      type?: string
      text?: string
    }>
  }
}

function parseStreamFrame(line: string): StreamFrame | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as StreamFrame
  } catch {
    return null
  }
}

function extractAssistantText(frame: StreamFrame): string {
  const parts = frame.message?.content
  if (!Array.isArray(parts)) return ""
  let out = ""
  for (const part of parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      out += part.text
    }
  }
  return out
}

function buildClaudeArgs({
  model,
  schemaJson,
}: {
  model: string
  schemaJson: unknown
}): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(schemaJson),
    "--model",
    model,
    "--no-session-persistence",
  ]
}

type RunOptions = {
  prompt: string
  schemaJson: unknown
  abortSignal?: AbortSignal
  onToken?: (text: string) => void
}

type SpawnResult =
  | { kind: "complete"; finalText: string }
  | { kind: "error"; code: ChatErrorCode; message: string }
  | { kind: "cancelled" }
  | { kind: "timeout"; reason: "idle" | "total" }

async function spawnClaudeCode({
  prompt,
  schemaJson,
  abortSignal,
  onToken,
}: RunOptions): Promise<SpawnResult> {
  const model = claudeCodeChatModel()

  return await new Promise<SpawnResult>((resolve) => {
    let proc: ClaudeCodeProcess
    try {
      proc = spawn(
        "claude",
        buildClaudeArgs({ model, schemaJson }),
        {
          env: { ...process.env, LANG: "en_US.UTF-8" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      ) as ClaudeCodeProcess
    } catch (error) {
      resolve({
        kind: "error",
        code: "provider_not_configured",
        message:
          error instanceof Error
            ? error.message
            : "claude CLI failed to start",
      })
      return
    }

    let stderrBuf = ""
    let lineBuffer = ""
    let finalText: string | null = null
    let upstreamError: string | null = null
    let settled = false

    const totalTimer = setTimeout(() => {
      if (settled) return
      settle({ kind: "timeout", reason: "total" })
    }, CLAUDE_CODE_TOTAL_TIMEOUT_MS)

    let idleTimer = setTimeout(() => {
      if (settled) return
      settle({ kind: "timeout", reason: "idle" })
    }, CLAUDE_CODE_IDLE_TIMEOUT_MS)

    function bumpIdle() {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (settled) return
        settle({ kind: "timeout", reason: "idle" })
      }, CLAUDE_CODE_IDLE_TIMEOUT_MS)
    }

    const abortListener = abortSignal
      ? () => settle({ kind: "cancelled" })
      : null

    function settle(result: SpawnResult) {
      if (settled) return
      settled = true
      clearTimeout(totalTimer)
      clearTimeout(idleTimer)
      try {
        proc.kill("SIGTERM")
      } catch {
        // proc may have already exited
      }
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener("abort", abortListener)
      }
      resolve(result)
    }

    if (abortSignal && abortListener) {
      if (abortSignal.aborted) {
        abortListener()
        return
      }
      abortSignal.addEventListener("abort", abortListener, { once: true })
    }

    function handleLine(line: string) {
      bumpIdle()
      const frame = parseStreamFrame(line)
      if (!frame) return

      if (frame.type === "result") {
        if (frame.is_error === true) {
          upstreamError =
            typeof frame.result === "string"
              ? frame.result
              : "Claude Code reported is_error=true"
          return
        }
        if (typeof frame.result === "string") {
          finalText = frame.result
          return
        }
        // Some versions emit result as a structured object.
        if (frame.result !== undefined && frame.result !== null) {
          finalText = JSON.stringify(frame.result)
        }
        return
      }

      if (frame.type === "assistant") {
        const text = extractAssistantText(frame)
        if (text && onToken) onToken(text)
      }
    }

    proc.stdout.on("data", (chunk: Buffer | string) => {
      lineBuffer += chunk.toString("utf8")
      let newlineIndex = lineBuffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = lineBuffer.slice(0, newlineIndex)
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        handleLine(line)
        newlineIndex = lineBuffer.indexOf("\n")
      }
    })

    proc.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuf += chunk.toString()
    })

    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      if (error?.code === "ENOENT") {
        settle({
          kind: "error",
          code: "provider_not_configured",
          message: "claude CLI is not installed or not available on PATH",
        })
        return
      }
      settle({
        kind: "error",
        code: "provider_unavailable",
        message: error?.message ?? "claude CLI failed to start",
      })
    })

    proc.on("close", (code, signal) => {
      if (settled) return

      // Drain any trailing buffered line.
      const tail = lineBuffer.trim()
      if (tail.length > 0) handleLine(tail)

      if (signal === "SIGTERM") {
        settle({
          kind: "error",
          code: "provider_timeout",
          message: "claude terminated before emitting a result",
        })
        return
      }

      if (upstreamError) {
        settle({
          kind: "error",
          code: "provider_unavailable",
          message: `Claude Code reported an error: ${upstreamError}`,
        })
        return
      }

      if (code !== 0) {
        const sanitizedStderr = stderrBuf.trim().slice(0, 500)
        settle({
          kind: "error",
          code: "provider_unavailable",
          message:
            sanitizedStderr ||
            `claude exited with status ${code ?? "unknown"}`,
        })
        return
      }

      if (finalText === null) {
        settle({
          kind: "error",
          code: "empty_response",
          message: "claude finished without emitting a result frame",
        })
        return
      }

      settle({ kind: "complete", finalText })
    })

    try {
      proc.stdin.write(prompt)
      proc.stdin.end()
    } catch (error) {
      settle({
        kind: "error",
        code: "provider_unavailable",
        message:
          error instanceof Error
            ? error.message
            : "claude stdin write failed",
      })
    }
  })
}

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseFinalJson(text: string): unknown {
  const normalized = stripMarkdownFence(text)
  let parsed: unknown = JSON.parse(normalized)
  if (typeof parsed === "string") {
    parsed = JSON.parse(stripMarkdownFence(parsed))
  }
  return parsed
}

// -----------------------------------------------------------------------------
// Chat-turn entry point
// -----------------------------------------------------------------------------

export async function runClaudeCodeChat({
  prompt,
  schemaJson,
  abortSignal,
  onToken,
}: {
  prompt: string
  schemaJson: unknown
  abortSignal?: AbortSignal
  onToken: (text: string) => void
}): Promise<ClaudeCodeRunResult> {
  if (!isClaudeCodeAllowed()) {
    return {
      kind: "error",
      code: "provider_not_configured",
      message:
        "Claude Code CLI is not enabled for this environment (set EXPERIENCE_AI_ALLOW_CLAUDE_CODE=true to opt in)",
    }
  }

  const result = await spawnClaudeCode({
    prompt,
    schemaJson,
    abortSignal,
    onToken,
  })

  if (result.kind === "complete") {
    let parsed: unknown
    try {
      parsed = parseFinalJson(result.finalText)
    } catch (error) {
      return {
        kind: "error",
        code: "invalid_json",
        message: `Claude Code final result was not valid JSON${
          error instanceof Error ? `: ${error.message}` : ""
        }`,
      }
    }
    return { kind: "envelope", raw: parsed }
  }

  if (result.kind === "cancelled") {
    return {
      kind: "error",
      code: "cancelled",
      message: "request aborted by client",
    }
  }

  if (result.kind === "timeout") {
    return {
      kind: "error",
      code: "provider_timeout",
      message:
        result.reason === "idle"
          ? `claude produced no output for ${CLAUDE_CODE_IDLE_TIMEOUT_MS}ms`
          : `claude turn timed out after ${CLAUDE_CODE_TOTAL_TIMEOUT_MS}ms`,
    }
  }

  return result
}

// -----------------------------------------------------------------------------
// Quality-draft entry point
// -----------------------------------------------------------------------------

export async function generateClaudeCodeStructuredOutput<T>({
  prompt,
  schemaJson,
  validate,
  abortSignal,
}: {
  prompt: string
  schemaJson: unknown
  validate: (payload: unknown) => T
  abortSignal?: AbortSignal
}): Promise<ClaudeCodeStructuredResult<T>> {
  if (!isClaudeCodeAllowed()) {
    throw new ClaudeCodeProviderError(
      "missing_provider",
      "Claude Code CLI is not enabled for this environment (set EXPERIENCE_AI_ALLOW_CLAUDE_CODE=true to opt in)",
    )
  }

  const model = claudeCodeChatModel()
  const attempts: ClaudeCodeProviderAttempt[] = []

  const result = await spawnClaudeCode({
    prompt,
    schemaJson,
    abortSignal,
    onToken: undefined,
  })

  if (result.kind === "error") {
    const reason = `${model}: ${result.message}`
    attempts.push({ model, status: "failed", reason })
    if (result.code === "provider_not_configured") {
      throw new ClaudeCodeProviderError("missing_provider", result.message, attempts)
    }
    if (result.code === "provider_unavailable") {
      throw new ClaudeCodeProviderError("upstream_error", result.message, attempts)
    }
    if (result.code === "invalid_json") {
      throw new ClaudeCodeProviderError(
        "validation_error",
        result.message,
        attempts,
      )
    }
    throw new ClaudeCodeProviderError("upstream_error", result.message, attempts)
  }

  if (result.kind === "cancelled") {
    attempts.push({ model, status: "failed", reason: `${model}: cancelled` })
    throw new ClaudeCodeProviderError("upstream_error", "Run cancelled", attempts)
  }

  if (result.kind === "timeout") {
    const reason =
      result.reason === "idle"
        ? `${model}: idle timeout after ${CLAUDE_CODE_IDLE_TIMEOUT_MS}ms`
        : `${model}: total timeout after ${CLAUDE_CODE_TOTAL_TIMEOUT_MS}ms`
    attempts.push({ model, status: "failed", reason })
    throw new ClaudeCodeProviderError(
      "timeout",
      `Claude Code generation timed out (${result.reason})`,
      attempts,
    )
  }

  let parsedJson: unknown
  try {
    parsedJson = parseFinalJson(result.finalText)
  } catch (error) {
    attempts.push({
      model,
      status: "failed",
      reason: `${model}: result was not valid JSON${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
    })
    throw new ClaudeCodeProviderError(
      "validation_error",
      `Claude Code result was not valid JSON${
        error instanceof Error ? `: ${error.message}` : ""
      }`,
      attempts,
    )
  }

  try {
    const payload = validate(parsedJson)
    return {
      payload,
      model,
      usedModel: model,
      attempts: [...attempts, { model, usedModel: model, status: "succeeded" }],
    }
  } catch (error) {
    attempts.push({
      model,
      status: "failed",
      reason: `${model}: schema validation failed${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
    })
    throw new ClaudeCodeProviderError(
      "validation_error",
      `Claude Code result failed schema validation${
        error instanceof Error ? `: ${error.message}` : ""
      }`,
      attempts,
    )
  }
}
