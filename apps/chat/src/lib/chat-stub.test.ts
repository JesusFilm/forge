import { afterEach, describe, expect, it, vi } from "vitest"

import { buildStubReply, STUB_REPLY_DELAY_MS, streamReply } from "./chat-stub"
import { encodeSseFrame } from "./sse"

describe("buildStubReply", () => {
  it("identifies itself as stubbed and echoes the user text", () => {
    const reply = buildStubReply("hello")
    expect(reply).toContain("Stubbed reply")
    expect(reply).toContain("no agent is connected")
    expect(reply).toContain("hello")
  })

  it("embeds quotes and newlines verbatim", () => {
    const text = 'line one\nline two with "quotes"'
    expect(buildStubReply(text)).toContain(text)
  })
})

describe("STUB_REPLY_DELAY_MS", () => {
  it("is a positive finite number", () => {
    expect(Number.isFinite(STUB_REPLY_DELAY_MS)).toBe(true)
    expect(STUB_REPLY_DELAY_MS).toBeGreaterThan(0)
  })
})

// A Response whose body streams the given SSE frames.
function sseResponse(
  frames: Array<{ event: string; data: unknown }>,
  init?: ResponseInit,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(encodeSseFrame(f.event, f.data)))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("streamReply — stub path (flag off)", () => {
  it("resolves a stub reply and never fetches", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn()
    const promise = streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
    const result = await promise
    expect(result).toEqual({
      ok: true,
      text: buildStubReply("hi"),
      sources: [],
      grounded: false,
      engine: "stub",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("resolves cancelled when aborted during the delay", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const promise = streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: false,
      signal: controller.signal,
    })
    controller.abort()
    const result = await promise
    expect(result).toEqual({ ok: false, reason: "cancelled", partialText: "" })
  })
})

describe("streamReply — seeker path (flag on)", () => {
  it("streams tokens then resolves with text + sources + grounded", async () => {
    const tokens: string[] = []
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "token_delta", data: { text: "Hel" } },
        { event: "token_delta", data: { text: "lo" } },
        {
          event: "result",
          data: {
            text: "Hello",
            grounded: true,
            sources: [
              {
                sourceName: "Doc",
                title: "Title",
                url: "https://example.org",
                score: 0.9,
                snippet: "snip",
              },
            ],
          },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      onToken: (t) => tokens.push(t),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(tokens).toEqual(["Hel", "lo"])
    expect(result).toEqual({
      ok: true,
      text: "Hello",
      grounded: true,
      engine: "seeker",
      sources: [
        {
          sourceName: "Doc",
          title: "Title",
          url: "https://example.org",
          score: 0.9,
          snippet: "snip",
        },
      ],
    })
  })

  it("resolves ok:true with empty sources when none cited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: { text: "answer", grounded: true, sources: [] },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, sources: [], grounded: true })
  })

  it("keeps partial text on a mid-stream error frame", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        { event: "token_delta", data: { text: "par" } },
        { event: "token_delta", data: { text: "tial" } },
        { event: "error", data: { reason: "generation_failed" } },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "generation_failed",
      partialText: "partial",
    })
  })

  it("maps a fetch rejection to network_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"))
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      partialText: "",
    })
  })

  it("maps a proxy 400 (rejected body) to invalid_request, not network_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "text and conversationId are required" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "invalid_request",
      partialText: "",
    })
  })

  it("honors first-terminal-wins (ignores a frame after the terminal)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: { text: "first", grounded: false, sources: [] },
        },
        { event: "error", data: { reason: "timeout" } },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, text: "first" })
  })

  it("filters malformed/untrusted sources from the result frame", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "result",
          data: {
            text: "answer",
            grounded: true,
            sources: [
              null,
              "not-an-object",
              { sourceName: "NoUrl" }, // missing url → dropped
              { url: "https://x.example" }, // missing sourceName → dropped
              {
                sourceName: "Good",
                url: "https://good.example",
                title: 42, // wrong type → null
                score: "high", // wrong type → 0
              },
            ],
          },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({
      ok: true,
      sources: [
        {
          sourceName: "Good",
          url: "https://good.example",
          title: null,
          score: 0,
          snippet: "",
        },
      ],
    })
  })

  it("surfaces parse_error when the stream ends with no terminal frame", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        sseResponse([{ event: "token_delta", data: { text: "x" } }]),
      )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      partialText: "x",
    })
  })
})
