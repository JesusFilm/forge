import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { envState } = vi.hoisted(() => ({
  envState: {
    EXPERIENCE_AI_ALLOW_CLAUDE_CODE: true as boolean | undefined,
    EXPERIENCE_AI_CLAUDE_CODE_MODEL: undefined as string | undefined,
  },
}))

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock("@/config/env", () => ({ env: envState }))
vi.mock("node:child_process", () => ({ spawn: spawnMock }))

import {
  CLAUDE_CODE_IDLE_TIMEOUT_MS,
  ClaudeCodeProviderError,
  claudeCodeChatModel,
  generateClaudeCodeStructuredOutput,
  runClaudeCodeChat,
} from "./experience-ai-claude-code"

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

function frame(obj: unknown): string {
  return JSON.stringify(obj) + "\n"
}

function emitFrames(proc: ProcStub, frames: string[]) {
  for (const f of frames) {
    proc.stdout.write(Buffer.from(f))
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
  envState.EXPERIENCE_AI_ALLOW_CLAUDE_CODE = true
  envState.EXPERIENCE_AI_CLAUDE_CODE_MODEL = undefined
  spawnMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("claudeCodeChatModel", () => {
  it("defaults to sonnet alias when env is unset", () => {
    expect(claudeCodeChatModel()).toBe("sonnet")
  })

  it("returns the env override when set", () => {
    envState.EXPERIENCE_AI_CLAUDE_CODE_MODEL = "opus"
    expect(claudeCodeChatModel()).toBe("opus")
  })
})

describe("runClaudeCodeChat", () => {
  it("forwards assistant text via onToken and resolves with the parsed envelope", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const tokens: string[] = []
    const envelope = { mutations: { title: "X" } }

    const promise = runClaudeCodeChat({
      prompt: "go",
      schemaJson: { type: "object" },
      onToken: (t) => tokens.push(t),
    })

    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "system", subtype: "init" }),
      frame({
        type: "assistant",
        message: { content: [{ type: "text", text: "Working… " }] },
      }),
      frame({
        type: "assistant",
        message: { content: [{ type: "text", text: "Done." }] },
      }),
      frame({
        type: "result",
        subtype: "success",
        is_error: false,
        result: JSON.stringify(envelope),
      }),
    ])
    endProc(proc, 0)

    const result = await promise
    expect(result.kind).toBe("envelope")
    if (result.kind === "envelope") {
      expect(result.raw).toEqual(envelope)
    }
    expect(tokens).toEqual(["Working… ", "Done."])
    expect(proc.kill).toHaveBeenCalled()
  })

  it("ignores frames with unknown `type` (forward-compat)", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const envelope = { mutations: {} }
    const promise = runClaudeCodeChat({
      prompt: "go",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "future_event", random: true }),
      frame({ type: "result", is_error: false, result: JSON.stringify(envelope) }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result.kind).toBe("envelope")
  })

  it("passes --json-schema as inline JSON string in spawn args", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "go",
      schemaJson: { type: "object", properties: { foo: { type: "string" } } },
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "result", is_error: false, result: "{}" }),
    ])
    endProc(proc, 0)
    await promise

    const [, args] = spawnMock.mock.calls[0]!
    const argList = args as string[]
    const schemaIdx = argList.indexOf("--json-schema")
    expect(schemaIdx).toBeGreaterThanOrEqual(0)
    const inlineJson = argList[schemaIdx + 1]!
    expect(() => JSON.parse(inlineJson)).not.toThrow()
    expect(JSON.parse(inlineJson)).toMatchObject({ type: "object" })
  })

  it("returns provider_not_configured when gate is off", async () => {
    envState.EXPERIENCE_AI_ALLOW_CLAUDE_CODE = false
    const result = await runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    expect(result).toMatchObject({
      kind: "error",
      code: "provider_not_configured",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("returns provider_not_configured on ENOENT", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    const enoent = Object.assign(new Error("not found"), { code: "ENOENT" })
    proc.emit("error", enoent)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "provider_not_configured",
    })
  })

  it("returns provider_unavailable on non-zero exit", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    proc.stderr.write(Buffer.from("auth required"))
    endProc(proc, 1)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "provider_unavailable",
    })
  })

  it("returns provider_unavailable when the result frame carries is_error:true", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({
        type: "result",
        is_error: true,
        result: "rate limit exceeded",
      }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "provider_unavailable",
      message: expect.stringContaining("rate limit"),
    })
  })

  it("returns empty_response when no result frame arrives", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "assistant", message: { content: [{ type: "text", text: "no result" }] } }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "error",
      code: "empty_response",
    })
  })

  it("returns invalid_json when result text is not parseable JSON", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "result", is_error: false, result: "not-json-at-all" }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({ kind: "error", code: "invalid_json" })
  })

  it("strips a markdown code fence around the result JSON", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({
        type: "result",
        is_error: false,
        result: '```json\n{"mutations":{}}\n```',
      }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "envelope",
      raw: { mutations: {} },
    })
  })

  it("accepts a structured object as the result field (newer CLI shape)", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({
        type: "result",
        is_error: false,
        result: { mutations: { title: "Y" } },
      }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "envelope",
      raw: { mutations: { title: "Y" } },
    })
  })

  it("returns cancelled when abortSignal fires mid-stream", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const controller = new AbortController()
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      abortSignal: controller.signal,
      onToken: () => {},
    })
    await Promise.resolve()
    controller.abort()
    const result = await promise
    expect(result).toMatchObject({ kind: "error", code: "cancelled" })
    expect(proc.kill).toHaveBeenCalled()
  })

  it("fires the idle timeout when no output arrives", async () => {
    vi.useFakeTimers()
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "x",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    vi.advanceTimersByTime(CLAUDE_CODE_IDLE_TIMEOUT_MS + 10)
    vi.useRealTimers()
    const result = await promise
    expect(result).toMatchObject({ kind: "error", code: "provider_timeout" })
  })

  it("recovers across a chunk that splits an NDJSON frame mid-line", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = runClaudeCodeChat({
      prompt: "go",
      schemaJson: {},
      onToken: () => {},
    })
    await Promise.resolve()
    const finalFrame = frame({
      type: "result",
      is_error: false,
      result: '{"mutations":{}}',
    })
    // Split in the middle of the JSON line.
    proc.stdout.write(Buffer.from(finalFrame.slice(0, 10)))
    proc.stdout.write(Buffer.from(finalFrame.slice(10)))
    endProc(proc, 0)
    const result = await promise
    expect(result).toMatchObject({
      kind: "envelope",
      raw: { mutations: {} },
    })
  })
})

describe("generateClaudeCodeStructuredOutput", () => {
  it("returns the validated payload on a happy result", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const payload = { x: 1 }
    const promise = generateClaudeCodeStructuredOutput({
      prompt: "hi",
      schemaJson: { type: "object" },
      validate: (p) => p as typeof payload,
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({
        type: "result",
        is_error: false,
        result: JSON.stringify(payload),
      }),
    ])
    endProc(proc, 0)
    const result = await promise
    expect(result.payload).toEqual(payload)
    expect(result.attempts.at(-1)?.status).toBe("succeeded")
  })

  it("throws ClaudeCodeProviderError(missing_provider) when gate is off", async () => {
    envState.EXPERIENCE_AI_ALLOW_CLAUDE_CODE = false
    await expect(
      generateClaudeCodeStructuredOutput({
        prompt: "hi",
        schemaJson: {},
        validate: (p) => p,
      }),
    ).rejects.toMatchObject({
      name: "ClaudeCodeProviderError",
      code: "missing_provider",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("throws ClaudeCodeProviderError(missing_provider) on ENOENT", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = generateClaudeCodeStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    proc.emit(
      "error",
      Object.assign(new Error("not found"), { code: "ENOENT" }),
    )
    await expect(promise).rejects.toMatchObject({
      name: "ClaudeCodeProviderError",
      code: "missing_provider",
    })
  })

  it("throws ClaudeCodeProviderError(upstream_error) on non-zero exit", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = generateClaudeCodeStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    endProc(proc, 1)
    await expect(promise).rejects.toMatchObject({
      name: "ClaudeCodeProviderError",
      code: "upstream_error",
    })
  })

  it("throws ClaudeCodeProviderError(validation_error) when result is non-JSON", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = generateClaudeCodeStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: (p) => p,
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "result", is_error: false, result: "not-json" }),
    ])
    endProc(proc, 0)
    await expect(promise).rejects.toMatchObject({
      name: "ClaudeCodeProviderError",
      code: "validation_error",
    })
  })

  it("throws ClaudeCodeProviderError(validation_error) when validate throws", async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    const promise = generateClaudeCodeStructuredOutput({
      prompt: "hi",
      schemaJson: {},
      validate: () => {
        throw new Error("rejected")
      },
    })
    await Promise.resolve()
    emitFrames(proc, [
      frame({ type: "result", is_error: false, result: '{"x":1}' }),
    ])
    endProc(proc, 0)
    await expect(promise).rejects.toMatchObject({
      name: "ClaudeCodeProviderError",
      code: "validation_error",
    })
  })
})

describe("ClaudeCodeProviderError", () => {
  it("carries the discriminated code and attempts list", () => {
    const err = new ClaudeCodeProviderError("timeout", "boom", [
      { model: "sonnet", status: "failed", reason: "timed out" },
    ])
    expect(err.code).toBe("timeout")
    expect(err.attempts).toHaveLength(1)
    expect(err.name).toBe("ClaudeCodeProviderError")
  })
})
