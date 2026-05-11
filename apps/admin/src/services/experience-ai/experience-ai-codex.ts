/**
 * Codex CLI adapter for the Experience AI chat surface.
 *
 * The Codex CLI (`codex exec`) is the chat-turn provider that has been
 * spawned in-line by the chat service since v1. This module extracts that
 * runner into a peer of `experience-ai-openrouter-free.ts` and
 * `experience-ai-ollama.ts`, and adds a structured-output entry point so
 * the quality-draft flow can also route through Codex when the editor
 * picks the `codex` channel.
 *
 * CLI invocation:
 *   codex exec -m <model> --output-schema <tmpfile> -
 *
 * `-` reads the prompt from stdin (more robust than positional argument —
 * avoids shell-arg quoting concerns for long prompts).
 * `--output-schema` constrains the final assistant message to a JSON
 * Schema. Codex validates against it; we re-validate with Zod regardless
 * because CLI schema enforcement is a hint, not a guarantee.
 *
 * Two flows, one shared spawn helper:
 *   - `runCodexChat`     — chat-turn path, line-buffered stdout, emits
 *                          token deltas, resolves with the parsed
 *                          envelope on the line that parses as JSON.
 *                          Behavior parity with the legacy in-service
 *                          `runCodexChat` — R8 invariant.
 *   - `generateCodexStructuredOutput<T>` — quality-draft path, uses
 *                          `--output-last-message <file>` to capture the
 *                          final assistant payload and validates it.
 *
 * The gate (`isCodexAllowed()`) is checked BEFORE spawn so an env that
 * hasn't opted into Codex returns `codex_unavailable` cleanly without
 * an ENOENT race.
 */

import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import readline from "node:readline"
import type { Readable, Writable } from "node:stream"

import { env } from "@/config/env"

import type { ChatErrorCode } from "./experience-ai-chat-error-codes"
import { isCodexAllowed } from "./experience-ai-cli-gates"

const DEFAULT_CODEX_CHAT_MODEL = "gpt-5.5"

export const CODEX_TOTAL_TIMEOUT_MS = 180_000
export const CODEX_IDLE_TIMEOUT_MS = 120_000

export type CodexProviderAttempt = {
  model: string
  status: "succeeded" | "failed"
  usedModel?: string
  reason?: string
}

export type CodexStructuredResult<T> = {
  payload: T
  model: string
  usedModel: string
  attempts: CodexProviderAttempt[]
}

export type CodexProviderErrorCode =
  | "missing_provider"
  | "upstream_error"
  | "validation_error"
  | "timeout"

export class CodexProviderError extends Error {
  constructor(
    readonly code: CodexProviderErrorCode,
    message: string,
    readonly attempts: CodexProviderAttempt[] = [],
  ) {
    super(message)
    this.name = "CodexProviderError"
  }
}

export type CodexRunResult =
  | { kind: "envelope"; raw: unknown }
  | { kind: "error"; code: ChatErrorCode; message: string }

export function codexChatModel(): string {
  return env.EXPERIENCE_AI_CODEX_MODEL ?? DEFAULT_CODEX_CHAT_MODEL
}

function isPotentialEnvelopeLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("{") && trimmed.endsWith("}")
}

function tryParseJson(line: string): unknown | null {
  try {
    return JSON.parse(line.trim())
  } catch {
    return null
  }
}

type CodexProcess = ChildProcessByStdio<Writable, Readable, Readable>

type SpawnArgs = {
  schemaPath: string | null
  outputFilePath: string | null
  model: string
}

function buildCodexArgs({
  schemaPath,
  outputFilePath,
  model,
}: SpawnArgs): string[] {
  const args = [
    "exec",
    "-m",
    model,
    "-c",
    'model_reasoning_effort="medium"',
    "--sandbox",
    "read-only",
  ]
  if (schemaPath) args.push("--output-schema", schemaPath)
  if (outputFilePath) args.push("-o", outputFilePath)
  args.push("-")
  return args
}

async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "forge-codex-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// -----------------------------------------------------------------------------
// Chat-turn path — preserves the in-service runCodexChat behavior for R8.
// -----------------------------------------------------------------------------

/**
 * Run a chat-turn via the Codex CLI. Behavior matches the legacy
 * in-service `runCodexChat` exactly so existing chat-service tests pass
 * unmodified — same error codes (`codex_unavailable`, `codex_timeout`,
 * `codex_idle_timeout`, `cancelled`, `empty_response`, `invalid_json`),
 * same readline-based stdout parsing.
 *
 * Token deltas are forwarded via `onToken`. The terminal envelope is
 * resolved through the discriminated result.
 */
export async function runCodexChat({
  prompt,
  schemaJson,
  abortSignal,
  onToken,
}: {
  prompt: string
  schemaJson?: unknown
  abortSignal?: AbortSignal
  onToken: (text: string) => void
}): Promise<CodexRunResult> {
  if (!isCodexAllowed()) {
    return {
      kind: "error",
      code: "codex_unavailable",
      message:
        "Codex CLI is not enabled for this environment (set EXPERIENCE_AI_ALLOW_CODEX=true to opt in)",
    }
  }

  return await withTempDir(async (dir) => {
    let schemaPath: string | null = null
    if (schemaJson !== undefined) {
      schemaPath = join(dir, "schema.json")
      await writeFile(schemaPath, JSON.stringify(schemaJson), "utf8")
    }

    return await new Promise<CodexRunResult>((resolve) => {
      let proc: CodexProcess
      try {
        proc = spawn(
          "codex",
          buildCodexArgs({
            schemaPath,
            outputFilePath: null,
            model: codexChatModel(),
          }),
          {
            env: { ...process.env, LANG: "en_US.UTF-8" },
            stdio: ["pipe", "pipe", "pipe"],
          },
        ) as CodexProcess
      } catch (error) {
        resolve({
          kind: "error",
          code: "codex_unavailable",
          message:
            error instanceof Error
              ? error.message
              : "codex CLI failed to start",
        })
        return
      }

      let stderrBuf = ""
      let sawAnyLine = false
      let settled = false
      const tailLines: string[] = []

      const totalTimer = setTimeout(() => {
        if (settled) return
        settle({
          kind: "error",
          code: "codex_timeout",
          message: `Codex turn timed out after ${CODEX_TOTAL_TIMEOUT_MS}ms`,
        })
      }, CODEX_TOTAL_TIMEOUT_MS)

      let idleTimer = setTimeout(() => {
        if (settled) return
        settle({
          kind: "error",
          code: "codex_idle_timeout",
          message: `Codex produced no output for ${CODEX_IDLE_TIMEOUT_MS}ms`,
        })
      }, CODEX_IDLE_TIMEOUT_MS)

      function bumpIdle() {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          if (settled) return
          settle({
            kind: "error",
            code: "codex_idle_timeout",
            message: `Codex produced no output for ${CODEX_IDLE_TIMEOUT_MS}ms`,
          })
        }, CODEX_IDLE_TIMEOUT_MS)
      }

      const abortListener = abortSignal
        ? () =>
            settle({
              kind: "error",
              code: "cancelled",
              message: "request aborted by client",
            })
        : null

      function settle(result: CodexRunResult) {
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

      const rl = readline.createInterface({ input: proc.stdout })
      rl.on("line", (line) => {
        sawAnyLine = true
        bumpIdle()
        tailLines.push(line)
        if (tailLines.length > 64) tailLines.shift()

        const tail = tailLines.join("\n").trim()
        if (isPotentialEnvelopeLine(tail)) {
          const parsedTail = tryParseJson(tail)
          if (parsedTail !== null) {
            settle({ kind: "envelope", raw: parsedTail })
            return
          }
        }

        if (isPotentialEnvelopeLine(line)) {
          const parsed = tryParseJson(line)
          if (parsed !== null) {
            settle({ kind: "envelope", raw: parsed })
            return
          }
        }

        onToken(line)
      })

      proc.stderr.on("data", (chunk: Buffer | string) => {
        stderrBuf += chunk.toString()
      })

      proc.on("error", (error: NodeJS.ErrnoException) => {
        if (error?.code === "ENOENT") {
          settle({
            kind: "error",
            code: "codex_unavailable",
            message: "codex CLI is not installed or not available on PATH",
          })
          return
        }
        settle({
          kind: "error",
          code: "codex_unavailable",
          message: error?.message ?? "codex CLI failed to start",
        })
      })

      proc.on("close", (code, signal) => {
        if (settled) return
        if (!sawAnyLine) {
          settle({
            kind: "error",
            code: "empty_response",
            message: "codex closed stdout without emitting any output",
          })
          return
        }
        if (signal === "SIGTERM") {
          settle({
            kind: "error",
            code: "codex_timeout",
            message: "codex terminated before emitting an envelope",
          })
          return
        }
        if (code !== 0) {
          const sanitizedStderr = stderrBuf.trim().slice(0, 500)
          settle({
            kind: "error",
            code: "codex_unavailable",
            message:
              sanitizedStderr ||
              `codex exited with status ${code ?? "unknown"}`,
          })
          return
        }
        settle({
          kind: "error",
          code: "invalid_json",
          message:
            "codex finished without emitting a parseable JSON envelope",
        })
      })

      try {
        proc.stdin.write(prompt)
        proc.stdin.end()
      } catch (error) {
        settle({
          kind: "error",
          code: "codex_unavailable",
          message:
            error instanceof Error
              ? error.message
              : "codex stdin write failed",
        })
      }
    })
  })
}

// -----------------------------------------------------------------------------
// Quality-draft path — structured output via --output-last-message file.
// -----------------------------------------------------------------------------

/**
 * Drive Codex through a single non-interactive run and return the
 * validated structured output. The `--output-last-message` flag captures
 * the final assistant message in a file we read post-exit, which is more
 * robust than parsing the streaming stdout for a multi-line JSON
 * envelope.
 */
export async function generateCodexStructuredOutput<T>({
  prompt,
  schemaJson,
  validate,
  abortSignal,
}: {
  prompt: string
  schemaJson: unknown
  validate: (payload: unknown) => T
  abortSignal?: AbortSignal
}): Promise<CodexStructuredResult<T>> {
  if (!isCodexAllowed()) {
    throw new CodexProviderError(
      "missing_provider",
      "Codex CLI is not enabled for this environment (set EXPERIENCE_AI_ALLOW_CODEX=true to opt in)",
    )
  }

  const model = codexChatModel()
  const attempts: CodexProviderAttempt[] = []

  return await withTempDir(async (dir) => {
    const schemaPath = join(dir, "schema.json")
    const outputPath = join(dir, "output.txt")
    await writeFile(schemaPath, JSON.stringify(schemaJson), "utf8")

    const { stderr, exitCode, signal } = await new Promise<{
      stderr: string
      exitCode: number | null
      signal: NodeJS.Signals | null
    }>((resolve) => {
      let proc: CodexProcess
      try {
        proc = spawn(
          "codex",
          buildCodexArgs({
            schemaPath,
            outputFilePath: outputPath,
            model,
          }),
          {
            env: { ...process.env, LANG: "en_US.UTF-8" },
            stdio: ["pipe", "pipe", "pipe"],
          },
        ) as CodexProcess
      } catch (error) {
        attempts.push({
          model,
          status: "failed",
          reason: `${model}: spawn failed (${
            error instanceof Error ? error.message : "unknown"
          })`,
        })
        throw new CodexProviderError(
          "missing_provider",
          error instanceof Error ? error.message : "codex spawn failed",
          attempts,
        )
      }

      let stderrBuf = ""
      let settled = false

      const totalTimer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          proc.kill("SIGTERM")
        } catch {}
        resolve({ stderr: stderrBuf, exitCode: null, signal: "SIGTERM" })
      }, CODEX_TOTAL_TIMEOUT_MS)

      const abortListener = abortSignal
        ? () => {
            if (settled) return
            settled = true
            clearTimeout(totalTimer)
            try {
              proc.kill("SIGTERM")
            } catch {}
            resolve({ stderr: stderrBuf, exitCode: null, signal: "SIGINT" })
          }
        : null

      if (abortSignal && abortListener) {
        if (abortSignal.aborted) {
          abortListener()
        } else {
          abortSignal.addEventListener("abort", abortListener, { once: true })
        }
      }

      proc.stderr.on("data", (chunk: Buffer | string) => {
        stderrBuf += chunk.toString()
      })

      // Drain stdout so the OS pipe buffer doesn't block.
      proc.stdout.on("data", () => {})

      proc.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        clearTimeout(totalTimer)
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener("abort", abortListener)
        }
        const code: number | null =
          error?.code === "ENOENT" ? null : (error as { errno?: number }).errno ?? null
        resolve({
          stderr: stderrBuf + (error?.message ?? ""),
          exitCode: code,
          signal: null,
        })
      })

      proc.on("close", (code, signal) => {
        if (settled) return
        settled = true
        clearTimeout(totalTimer)
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener("abort", abortListener)
        }
        resolve({ stderr: stderrBuf, exitCode: code, signal })
      })

      try {
        proc.stdin.write(prompt)
        proc.stdin.end()
      } catch (error) {
        if (settled) return
        settled = true
        clearTimeout(totalTimer)
        resolve({
          stderr:
            stderrBuf +
            (error instanceof Error ? error.message : "stdin write failed"),
          exitCode: null,
          signal: null,
        })
      }
    })

    if (signal === "SIGINT") {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: cancelled by upstream`,
      })
      throw new CodexProviderError("upstream_error", "Run cancelled", attempts)
    }
    if (signal === "SIGTERM") {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: timed out after ${CODEX_TOTAL_TIMEOUT_MS}ms`,
      })
      throw new CodexProviderError(
        "timeout",
        `Codex generation timed out after ${CODEX_TOTAL_TIMEOUT_MS}ms`,
        attempts,
      )
    }

    if (exitCode !== 0) {
      const detail = stderr.trim().slice(0, 500)
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: exit ${exitCode ?? "unknown"}${
          detail ? `: ${detail}` : ""
        }`,
      })
      // Distinguish ENOENT-shaped failures (missing CLI) from real upstream
      // errors. Codex prints a recognizable message on missing-binary.
      if (
        /ENOENT|not found|not installed|command not found/i.test(stderr ?? "")
      ) {
        throw new CodexProviderError(
          "missing_provider",
          "codex CLI is not installed or not available on PATH",
          attempts,
        )
      }
      throw new CodexProviderError(
        "upstream_error",
        `Codex generation failed (exit ${exitCode ?? "unknown"})`,
        attempts,
      )
    }

    let outputText: string
    try {
      outputText = await readFile(outputPath, "utf8")
    } catch (error) {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: output file unreadable (${
          error instanceof Error ? error.message : "unknown"
        })`,
      })
      throw new CodexProviderError(
        "validation_error",
        "Codex did not produce an output file",
        attempts,
      )
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(outputText.trim())
    } catch (error) {
      attempts.push({
        model,
        status: "failed",
        reason: `${model}: output was not valid JSON${
          error instanceof Error ? ` (${error.message})` : ""
        }`,
      })
      throw new CodexProviderError(
        "validation_error",
        `Codex output was not valid JSON${
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
      throw new CodexProviderError(
        "validation_error",
        `Codex output failed schema validation${
          error instanceof Error ? `: ${error.message}` : ""
        }`,
        attempts,
      )
    }
  })
}
