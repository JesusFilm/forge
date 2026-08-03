import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KEY_VARIABLE } from "./env"
import {
  completeJson,
  completeWithInjectedTool,
  EvalLlmError,
} from "./openrouter"

/**
 * Env hygiene: `resolveOpenRouterKey` treats an EMPTY value as unset but a
 * present empty string still blocks the dotenv loader from reading a real key
 * off disk — so setting "" makes the missing-key tests hermetic even on a
 * machine whose apps/mastra/.env.local carries the real credential.
 */
const TOUCHED = [
  KEY_VARIABLE,
  "OPENROUTER_API_PAID_KEY",
  "OPENROUTER_API_KEY",
  "CHAT_EVAL_MAX_RESPONSE_BYTES",
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const name of TOUCHED) {
    saved[name] = process.env[name]
    process.env[name] = ""
  }
})

afterEach(() => {
  for (const name of TOUCHED) {
    if (saved[name] == null) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const JUDGE_PAYLOAD = {
  choices: [
    {
      message: { content: JSON.stringify({ graded: true }) },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
}

describe("fail-before-spending (the dedicated-key guarantee)", () => {
  it("throws missing_credentials BEFORE any fetch when the eval key is absent", async () => {
    const fetchSpy = vi.fn()
    await expect(
      completeJson({
        model: "anthropic/claude-haiku-4.5",
        system: "s",
        user: "u",
        jsonSchema: { name: "x", schema: {} },
        parse: (value) => value,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "EvalLlmError",
      code: "missing_credentials",
    })
    // The MECHANISM: no network call ever happened, so nothing was billed.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("names the refused sibling credentials in the failure text", async () => {
    process.env.OPENROUTER_API_KEY = "sk-production-key"
    await expect(
      completeJson({
        model: "anthropic/claude-haiku-4.5",
        system: "s",
        user: "u",
        jsonSchema: { name: "x", schema: {} },
        parse: (value) => value,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Refusing to use OPENROUTER_API_KEY/)
  })

  it("sends ONLY the dedicated key as the bearer when present", async () => {
    process.env[KEY_VARIABLE] = "sk-eval-key"
    process.env.OPENROUTER_API_KEY = "sk-production-key"
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        void init
        return jsonResponse(JUDGE_PAYLOAD)
      },
    )
    const result = await completeJson({
      model: "anthropic/claude-haiku-4.5",
      system: "s",
      user: "u",
      jsonSchema: { name: "x", schema: {} },
      parse: (value) => value as { graded: boolean },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(result.value).toEqual({ graded: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1]
    expect(init).toBeDefined()
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-eval-key",
    )
  })
})

describe("byte-cap wiring on the buffered response read", () => {
  it("maps an over-cap body to request_failed after aborting the stream", async () => {
    process.env[KEY_VARIABLE] = "sk-eval-key"
    process.env.CHAT_EVAL_MAX_RESPONSE_BYTES = "64"
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(128))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchSpy = vi.fn(async () => new Response(stream, { status: 200 }))
    await expect(
      completeJson({
        model: "anthropic/claude-haiku-4.5",
        system: "s",
        user: "u",
        jsonSchema: { name: "x", schema: {} },
        parse: (value) => value,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "request_failed" })
    expect(cancelled).toBe(true)
  })
})

describe("completeWithInjectedTool", () => {
  it("sends the scripted tool exchange and forces a text answer", async () => {
    process.env[KEY_VARIABLE] = "sk-eval-key"
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        void init
        return jsonResponse({
          choices: [
            { message: { content: "an answer" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
      },
    )
    const completion = await completeWithInjectedTool({
      model: "google/gemma-4-31b-it",
      system: "system prompt",
      user: "the question",
      toolSpec: { function: { name: "retrieveAnswer" } },
      query: "the question",
      toolResult: { status: "ok", sources: [] },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(completion.text).toBe("an answer")
    expect(completion.finishReason).toBe("stop")
    expect(completion.usage).toEqual({ input: 100, output: 50 })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as {
      tool_choice: string
      messages: Array<{ role: string; tool_call_id?: string }>
    }
    // tool_choice: "none" — the model may not re-call the tool, which is
    // what keeps this mode deterministic.
    expect(body.tool_choice).toBe("none")
    expect(body.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ])
    expect(body.messages[3].tool_call_id).toBe("call_retrieveAnswer_eval")
  })
})

describe("error surface", () => {
  it("maps a 4xx to request_failed without retrying", async () => {
    process.env[KEY_VARIABLE] = "sk-eval-key"
    const fetchSpy = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    )
    await expect(
      completeJson({
        model: "anthropic/claude-haiku-4.5",
        system: "s",
        user: "u",
        jsonSchema: { name: "x", schema: {} },
        parse: (value) => value,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "request_failed" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("exposes a typed error class", () => {
    const error = new EvalLlmError("transport", "boom")
    expect(error.name).toBe("EvalLlmError")
    expect(error.code).toBe("transport")
  })
})
