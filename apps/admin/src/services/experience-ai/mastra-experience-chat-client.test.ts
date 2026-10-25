import { describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    MASTRA_CHAT_BASE_URL: undefined as string | undefined,
    MASTRA_CHAT_API_KEY: undefined as string | undefined,
    MASTRA_CHAT_ALLOWED_HOSTS: undefined as string | undefined,
    MASTRA_CHAT_TIMEOUT_MS: 95_000,
  },
}))

import { streamMastraExperienceChat } from "./mastra-experience-chat-client"

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
}

function streamResponse(status: number, frames: string[]): Response {
  return new Response(status === 401 ? "" : sseBody(frames), {
    status,
    headers: { "content-type": "text/event-stream" },
  })
}

const tokenFrame = (text: string) =>
  `event: token_delta\ndata: ${JSON.stringify({ text })}\n\n`
const resultFrame = (text: string, producedBy = "experience-default-chat") =>
  `event: result\ndata: ${JSON.stringify({ text, producedBy })}\n\n`
const errorFrame = (reason: string, message?: string) =>
  `event: error\ndata: ${JSON.stringify({ reason, message })}\n\n`

const BASE = {
  prompt: "hello",
  baseUrl: "https://mastra.example",
  apiKey: "svc-key",
}

describe("streamMastraExperienceChat", () => {
  it("returns config_missing when base URL / key are unset", async () => {
    const result = await streamMastraExperienceChat({
      prompt: "x",
      onToken: vi.fn(),
      fetchImpl: vi.fn(),
    })
    expect(result).toEqual({ ok: false, reason: "config_missing" })
  })

  it("rejects a non-allowlisted base URL BEFORE any fetch (SSRF)", async () => {
    const fetchImpl = vi.fn()
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      allowedHosts: "other.example",
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "ssrf_blocked" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("allows a base URL whose host is in the allowlist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(streamResponse(200, [resultFrame('{"mutations":{}}')]))
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      allowedHosts: "mastra.example,other.example",
      fetchImpl,
    })
    expect(result.ok).toBe(true)
  })

  it("relays token_delta frames via onToken and returns the result text", async () => {
    const onToken = vi.fn()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse(200, [
          tokenFrame("Hel"),
          tokenFrame("lo"),
          resultFrame(
            '{"mutations":{"title":"Hi"}}',
            "experience-default-chat",
          ),
        ]),
      )
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken,
      fetchImpl,
    })
    expect(onToken.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo"])
    expect(result).toEqual({
      ok: true,
      text: '{"mutations":{"title":"Hi"}}',
      producedBy: "experience-default-chat",
    })
    // Posted with a Bearer + redirect:error.
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe("https://mastra.example/forge-experience-chat")
    expect((init as RequestInit).redirect).toBe("error")
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ authorization: "Bearer svc-key" })
  })

  it("maps a 401 to auth_failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse(401, []))
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "auth_failed" })
  })

  it("propagates an upstream error frame (timeout) as reason=timeout", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(streamResponse(200, [errorFrame("timeout", "slow")]))
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "timeout" })
  })

  it("maps a non-timeout error frame to generation_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(streamResponse(200, [errorFrame("generation_failed")]))
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "generation_failed" })
  })

  it("returns parse_error when the stream ends with no result frame", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(streamResponse(200, [tokenFrame("partial")]))
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "parse_error" })
  })

  it("classifies a caller-abort (closed tab) as cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      )
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      abortSignal: controller.signal,
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "cancelled" })
  })

  it("classifies a fetch TimeoutError as timeout", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      )
    const result = await streamMastraExperienceChat({
      ...BASE,
      onToken: vi.fn(),
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "timeout" })
  })
})
