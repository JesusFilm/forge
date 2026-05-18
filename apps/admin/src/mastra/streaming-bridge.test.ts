import { describe, expect, it } from "vitest"

import { adaptMastraStream, type MastraStreamPart } from "./streaming-bridge"
import type { ChatStreamEvent } from "./chat-stream-event"

/**
 * The bridge takes an `AsyncIterable<MastraStreamPart>` (an
 * abstraction over Mastra's UIMessageStream) and yields
 * `ChatStreamEvent` values the panel renders. Tests pass synthetic
 * stream parts through the adapter and assert the emitted union
 * matches the contract.
 */

async function collect(
  iter: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const event of iter) out.push(event)
  return out
}

async function* fromParts(
  parts: MastraStreamPart[],
): AsyncIterable<MastraStreamPart> {
  for (const part of parts) yield part
}

const MESSAGE_ID = "msg-spike-1"

describe("streaming-bridge", () => {
  it("maps text-delta parts to token_delta events in order", async () => {
    const events = await collect(
      adaptMastraStream(
        fromParts([
          { kind: "text-delta", text: "Hel" },
          { kind: "text-delta", text: "lo " },
          { kind: "text-delta", text: "world." },
          { kind: "finish", messageId: MESSAGE_ID },
        ]),
      ),
    )
    expect(events).toEqual([
      { type: "token_delta", text: "Hel" },
      { type: "token_delta", text: "lo " },
      { type: "token_delta", text: "world." },
      { type: "done", messageId: MESSAGE_ID },
    ])
  })

  it("emits a done event at finish with the message id", async () => {
    const events = await collect(
      adaptMastraStream(fromParts([{ kind: "finish", messageId: MESSAGE_ID }])),
    )
    expect(events).toEqual([{ type: "done", messageId: MESSAGE_ID }])
  })

  it("emits an empty-stream done with the supplied message id", async () => {
    const events = await collect(
      adaptMastraStream(fromParts([{ kind: "finish", messageId: MESSAGE_ID }])),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "done" })
  })

  it("emits mutation_applied for a finish carrying a structured envelope diff", async () => {
    const diff = {
      scalars: { title: { before: "Old", after: "New" } },
      blocks: [{ t: "text", contentParagraphs: ["x"] }],
    }
    const events = await collect(
      adaptMastraStream(
        fromParts([
          { kind: "text-delta", text: "Working..." },
          {
            kind: "finish",
            messageId: MESSAGE_ID,
            envelope: { diff },
          },
        ]),
      ),
    )
    expect(events).toEqual([
      { type: "token_delta", text: "Working..." },
      { type: "mutation_applied", messageId: MESSAGE_ID, diff },
      { type: "done", messageId: MESSAGE_ID },
    ])
  })

  it("emits an error event when a stream part throws mid-flight (and skips done)", async () => {
    async function* failing(): AsyncIterable<MastraStreamPart> {
      yield { kind: "text-delta", text: "Partial" }
      throw Object.assign(new Error("provider blew up"), {
        name: "ProviderError",
      })
    }
    const events = await collect(adaptMastraStream(failing()))
    expect(events).toEqual([
      { type: "token_delta", text: "Partial" },
      {
        type: "error",
        code: "unknown",
        message: "provider blew up",
      },
    ])
  })

  it("classifies a ProviderNotConfiguredError-shaped error as provider_not_configured", async () => {
    async function* failing(): AsyncIterable<MastraStreamPart> {
      if (false as boolean) yield { kind: "text-delta", text: "" }
      throw Object.assign(new Error("OPENROUTER_API_KEY missing"), {
        name: "ProviderNotConfiguredError",
      })
    }
    const events = await collect(adaptMastraStream(failing()))
    expect(events).toEqual([
      {
        type: "error",
        code: "provider_not_configured",
        message: "OPENROUTER_API_KEY missing",
      },
    ])
  })

  it("classifies a timeout-shaped error as timeout", async () => {
    async function* failing(): AsyncIterable<MastraStreamPart> {
      if (false as boolean) yield { kind: "text-delta", text: "" }
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    }
    const events = await collect(adaptMastraStream(failing()))
    expect(events).toEqual([
      { type: "error", code: "timeout", message: "aborted" },
    ])
  })

  it("emits tool_call_started and tool_call_completed for tool parts", async () => {
    const events = await collect(
      adaptMastraStream(
        fromParts([
          {
            kind: "tool-call",
            toolId: "searchVideos",
            callId: "call-1",
          },
          {
            kind: "tool-result",
            toolId: "searchVideos",
            callId: "call-1",
            durationMs: 42,
          },
          { kind: "finish", messageId: MESSAGE_ID },
        ]),
      ),
    )
    expect(events).toEqual([
      {
        type: "tool_call_started",
        toolId: "searchVideos",
        callId: "call-1",
      },
      {
        type: "tool_call_completed",
        toolId: "searchVideos",
        callId: "call-1",
        durationMs: 42,
      },
      { type: "done", messageId: MESSAGE_ID },
    ])
  })

  it("emits validation_failed when envelope is present but malformed (no diff field)", async () => {
    const events = await collect(
      adaptMastraStream(
        fromParts([
          {
            kind: "finish",
            messageId: MESSAGE_ID,
            envelope: { somethingElse: true },
          },
        ]),
      ),
    )
    expect(events).toEqual([
      {
        type: "error",
        code: "validation_failed",
        message: expect.stringMatching(/envelope/i),
      },
    ])
  })

  it("delivers token_delta events that arrived before an error", async () => {
    async function* mixed(): AsyncIterable<MastraStreamPart> {
      yield { kind: "text-delta", text: "first" }
      yield { kind: "text-delta", text: "second" }
      throw new Error("late failure")
    }
    const events = await collect(adaptMastraStream(mixed()))
    expect(events.slice(0, 2)).toEqual([
      { type: "token_delta", text: "first" },
      { type: "token_delta", text: "second" },
    ])
    expect(events[events.length - 1]).toMatchObject({ type: "error" })
  })
})
