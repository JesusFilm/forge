// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { openChatStream } from "./experience-chat-stream-client"

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iter) out.push(item)
  return out
}

describe("openChatStream", () => {
  it("yields scripted SSE frames in order (happy path)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeStreamResponse([
        `event: token_delta\ndata: ${JSON.stringify({ text: "hi" })}\n\n`,
        `event: mutation_applied\ndata: ${JSON.stringify({
          messageId: "m-1",
          diff: { scalars: {} },
        })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ messageId: "m-1" })}\n\n`,
      ]),
    )

    const events = await collect(
      openChatStream({ threadId: "t-1", prompt: "hi" }, { fetchImpl }),
    )

    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ type: "token_delta", text: "hi" })
    expect(events[1]).toMatchObject({
      type: "mutation_applied",
      messageId: "m-1",
    })
    expect(events[2]).toEqual({ type: "done", messageId: "m-1" })
  })

  it("buffers partial frames split mid-frame across chunks", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([
          "event: token_delta\nda",
          `ta: ${JSON.stringify({ text: "split" })}\n\n`,
        ]),
      )

    const events = await collect(
      openChatStream({ threadId: "t", prompt: "p" }, { fetchImpl }),
    )

    expect(events).toEqual([{ type: "token_delta", text: "split" }])
  })

  it("parses multiple frames packed into one chunk", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([
          [
            `event: token_delta\ndata: ${JSON.stringify({ text: "a" })}`,
            ``,
            `event: token_delta\ndata: ${JSON.stringify({ text: "b" })}`,
            ``,
            ``,
          ].join("\n"),
        ]),
      )

    const events = await collect(
      openChatStream({ threadId: "t", prompt: "p" }, { fetchImpl }),
    )

    expect(events).toEqual([
      { type: "token_delta", text: "a" },
      { type: "token_delta", text: "b" },
    ])
  })

  it("propagates an AbortSignal — fetch sees the signal and the consumer terminates", async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      const signal = init.signal as AbortSignal
      if (signal.aborted) {
        return Promise.reject(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        )
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      })
    })

    controller.abort()

    let threw = false
    try {
      await collect(
        openChatStream(
          { threadId: "t", prompt: "p" },
          { fetchImpl, signal: controller.signal },
        ),
      )
    } catch {
      threw = true
    }

    // Pre-aborted fetch rejects from inside the generator; openChatStream
    // surfaces that as a thrown error during iteration.
    expect(fetchImpl).toHaveBeenCalled()
    expect(threw).toBe(true)
  })

  it("yields an error event on malformed SSE frame", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeStreamResponse([
        // Missing `event:` line — only `data:`.
        `data: ${JSON.stringify({ text: "no event" })}\n\n`,
      ]),
    )

    const events = await collect(
      openChatStream({ threadId: "t", prompt: "p" }, { fetchImpl }),
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "error", code: "unknown" })
  })

  it("yields an error event when the data payload is invalid JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([`event: token_delta\ndata: {not-json\n\n`]),
      )

    const events = await collect(
      openChatStream({ threadId: "t", prompt: "p" }, { fetchImpl }),
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "error", code: "unknown" })
  })

  it("ignores frames with an unknown event type while still parsing known ones", async () => {
    // An unknown discriminator (e.g. a future server event the client
    // doesn't model) must be skipped — not cast through as a bogus union
    // member. Surrounding known events still parse normally.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeStreamResponse([
          `event: token_delta\ndata: ${JSON.stringify({ text: "a" })}\n\n`,
          `event: heartbeat\ndata: ${JSON.stringify({ ts: 123 })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ messageId: "m-1" })}\n\n`,
        ]),
      )

    const events = await collect(
      openChatStream({ threadId: "t", prompt: "p" }, { fetchImpl }),
    )

    // The unknown `heartbeat` frame is dropped — only the two known
    // events survive, and neither is an error.
    expect(events).toEqual([
      { type: "token_delta", text: "a" },
      { type: "done", messageId: "m-1" },
    ])
  })

  it("surfaces a non-200 response as a typed error event", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 429 }))

    const events = await collect(
      openChatStream({ threadId: "t", prompt: "p" }, { fetchImpl }),
    )

    expect(events).toEqual([
      {
        type: "error",
        code: "rate_limited",
        message: expect.stringContaining("429"),
      },
    ])
  })
})
