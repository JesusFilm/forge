import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { envState } = vi.hoisted(() => ({
  envState: {
    EXPERIENCE_AI_ALLOW_CODEX: true as boolean | undefined,
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: undefined as boolean | undefined,
    EXPERIENCE_AI_CODEX_MODEL: undefined as string | undefined,
  },
}))

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

const { fsMocks } = vi.hoisted(() => ({
  fsMocks: {
    mkdtemp: vi.fn(async () => "/tmp/forge-codex-test"),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(),
    rm: vi.fn(async () => undefined),
  },
}))

vi.mock("@/config/env", () => ({ env: envState }))
vi.mock("node:child_process", () => ({ spawn: spawnMock }))
vi.mock("node:fs/promises", () => fsMocks)
vi.mock("./experience-ai-cli-gates", async () => {
  const actual = await vi.importActual<
    typeof import("./experience-ai-cli-gates")
  >("./experience-ai-cli-gates")
  return actual
})

import {
  CODEX_IDLE_TIMEOUT_MS,
  CODEX_TOTAL_TIMEOUT_MS,
  CodexProviderError,
  codexChatModel,
  generateCodexStructuredOutput,
  runCodexChat,
} from "./experience-ai-codex"

type ProcStub = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function makeProc(): ProcStub {
  const proc = new EventEmitter() as ProcStub
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  proc.kill = vi.fn()
  return proc
}

function emitLines(proc: ProcStub, lines: string[]) {
  for (const line of lines) {
    proc.stdout.write(Buffer.from(line + "\n"))
  }
}

function endProc(
  proc: ProcStub,
  code: number | null = 0,
  signal: NodeJS.Signals | null = null,
) {
  proc.stdout.end()
  proc.stderr.end()
  setImmediate(() => proc.emit("close", code, signal))
}

beforeEach(() => {
  envState.EXPERIENCE_AI_ALLOW_CODEX = true
  envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = undefined
  envState.EXPERIENCE_AI_CODEX_MODEL = undefined
  spawnMock.mockReset()
  fsMocks.mkdtemp.mockReset().mockResolvedValue("/tmp/forge-codex-test")
  fsMocks.writeFile.mockReset().mockResolvedValue(undefined)
  fsMocks.readFile.mockReset()
  fsMocks.rm.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("codexChatModel", () => {
  it("defaults to gpt-5.5 when env is unset", () => {
    expect(codexChatModel()).toBe("gpt-5.5")
  })

  it("returns the env override when set", () => {
    envState.EXPERIENCE_AI_CODEX_MODEL = "gpt-5"
    expect(codexChatModel()).toBe("gpt-5")
  })
})

describe("runCodexChat", () => {
  it("emits tokens then resolves with the parsed envelope", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const tokens: string[] = []

    const promise = runCodexChat({
      prompt: "go",
      onToken: (t) => tokens.push(t),
    })

    await Promise.resolve()
    emitLines(proc, [
      "thinking…",
      "more text",
      '{"mutations":{"title":"X"},"reason":"r"}',
    ])
    endProc(proc, 0)

    const result = await promise
    expect(result.kind).toBe("envelope")
    if (result.kind === "envelope") {
      expect(result.raw).toEqual({
        mutations: { title: "X" },
        reason: "r",
      })
    }
    expect(tokens).toEqual(["thinking…", "more text"])
    expect(proc.kill).toHaveBeenCalled()
  })

  it("returns codex_unavailable when the gate is off", async () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX = false
    const result = await runCodexChat({ prompt: "x", onToken: () => {} })
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_unavailable",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns codex_unavailable when spawn throws", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed")
    })
    const result = await runCodexChat({ prompt: "x", onToken: () => {} })
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_unavailable",
    })
  })

  it("returns codex_unavailable on ENOENT error event", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" })
    proc.emit("error", enoent)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_unavailable",
      message: expect.stringContaining("not installed"),
    })
  })

  it("returns empty_response when stdout closes with no output", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "empty_response",
    })
  })

  it("returns invalid_json when stdout has tokens but no envelope", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    emitLines(proc, ["thinking", "more"])
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "invalid_json",
    })
  })

  it("returns cancelled when abortSignal fires", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const controller = new AbortController()
    const promise = runCodexChat({
      prompt: "x",
      abortSignal: controller.signal,
      onToken: () => {},
    })
    await Promise.resolve()
    controller.abort()
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "cancelled",
    })
    expect(proc.kill).toHaveBeenCalled()
  })

  it("returns cancelled immediately when abortSignal is already aborted", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const controller = new AbortController()
    controller.abort()
    const result = await runCodexChat({
      prompt: "x",
      abortSignal: controller.signal,
      onToken: () => {},
    })
    expect(result).toMatchObject({ kind: "error", code: "cancelled" })
  })

  it("returns codex_unavailable on non-zero exit with stderr detail", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    proc.stderr.write(Buffer.from("auth error"))
    emitLines(proc, ["thinking"])
    endProc(proc, 1)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_unavailable",
      message: expect.stringContaining("auth error"),
    })
  })

  it("treats SIGTERM close as codex_timeout when not already settled", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    emitLines(proc, ["thinking"])
    endProc(proc, null, "SIGTERM")
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_timeout",
    })
  })

  it("fires the idle timeout when no output arrives", async () => {
    vi.useFakeTimers()
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    vi.advanceTimersByTime(CODEX_IDLE_TIMEOUT_MS + 10)
    vi.useRealTimers()
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_idle_timeout",
    })
  })

  it("fires the total timeout when output is slow but envelope never arrives", async () => {
    vi.useFakeTimers()
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({ prompt: "x", onToken: () => {} })
    await Promise.resolve()
    // Trickle a line every IDLE/2 ms to keep the idle timer alive.
    for (let i = 0; i < 4; i++) {
      proc.stdout.write(Buffer.from(`tick-${i}\n`))
      await vi.advanceTimersByTimeAsync(CODEX_IDLE_TIMEOUT_MS / 2)
    }
    // Push past total timeout.
    vi.advanceTimersByTime(CODEX_TOTAL_TIMEOUT_MS)
    vi.useRealTimers()
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "codex_timeout",
    })
  })

  it("passes --output-schema when schemaJson is provided", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runCodexChat({
      prompt: "go",
      schemaJson: { type: "object" },
      onToken: () => {},
    })
    await Promise.resolve()
    emitLines(proc, ['{"mutations":{}}'])
    endProc(proc, 0)
    await promise

    const [, args] = spawnMock.mock.calls[0]!
    expect(args).toContain("--output-schema")
    expect(fsMocks.writeFile).toHaveBeenCalled()
  })
})

describe("generateCodexStructuredOutput", () => {
  it("returns the validated payload on a happy round-trip", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ ok: true }))

    const promise = generateCodexStructuredOutput({
      prompt: "hi",
      schemaJson: { type: "object" },
      validate: (payload) => payload as { ok: boolean },
    })

    await Promise.resolve()
    endProc(proc, 0)

    const result = await promise
    expect(result.payload).toEqual({ ok: true })
    expect(result.model).toBe("gpt-5.5")
    expect(result.attempts.at(-1)?.status).toBe("succeeded")
  })

  it("throws CodexProviderError(missing_provider) when gate is off", async () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX = false
    await expect(
      generateCodexStructuredOutput({
        prompt: "hi",
        schemaJson: {},
        validate: (p) => p,
      }),
    ).rejects.toMatchObject({
      name: "CodexProviderError",
      code: "missing_provider",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("throws CodexProviderError(upstream_error) on non-zero exit", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = generateCodexStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    proc.stderr.write(Buffer.from("crash"))
    endProc(proc, 1)
    await expect(promise).rejects.toMatchObject({
      name: "CodexProviderError",
      code: "upstream_error",
    })
  })

  it("throws CodexProviderError(missing_provider) when stderr looks like ENOENT", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = generateCodexStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    proc.stderr.write(Buffer.from("codex: command not found"))
    endProc(proc, 127)
    await expect(promise).rejects.toMatchObject({
      name: "CodexProviderError",
      code: "missing_provider",
    })
  })

  it("throws CodexProviderError(validation_error) when output is not JSON", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    fsMocks.readFile.mockResolvedValue("not-json")

    const promise = generateCodexStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    endProc(proc, 0)

    await expect(promise).rejects.toMatchObject({
      name: "CodexProviderError",
      code: "validation_error",
    })
  })

  it("throws CodexProviderError(validation_error) when validate throws", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    fsMocks.readFile.mockResolvedValue(JSON.stringify({ x: 1 }))

    const promise = generateCodexStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: () => {
        throw new Error("schema rejected")
      },
    })
    await Promise.resolve()
    endProc(proc, 0)

    await expect(promise).rejects.toMatchObject({
      name: "CodexProviderError",
      code: "validation_error",
    })
  })

  it("throws CodexProviderError(validation_error) when output file is unreadable", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    fsMocks.readFile.mockRejectedValue(new Error("ENOENT"))

    const promise = generateCodexStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    endProc(proc, 0)

    await expect(promise).rejects.toMatchObject({
      name: "CodexProviderError",
      code: "validation_error",
    })
  })

  it("cleans up the temp dir even when spawn fails", async () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX = true
    spawnMock.mockImplementation(() => {
      throw new Error("spawn boom")
    })

    await expect(
      generateCodexStructuredOutput({
        prompt: "hi",
        schemaJson: {},
        validate: (p) => p,
      }),
    ).rejects.toBeInstanceOf(CodexProviderError)
    expect(fsMocks.rm).toHaveBeenCalled()
  })
})

describe("CodexProviderError", () => {
  it("carries the discriminated code and attempts list", () => {
    const err = new CodexProviderError("timeout", "boom", [
      { model: "gpt-5.5", status: "failed", reason: "timed out" },
    ])
    expect(err.code).toBe("timeout")
    expect(err.attempts).toHaveLength(1)
    expect(err.name).toBe("CodexProviderError")
  })
})
