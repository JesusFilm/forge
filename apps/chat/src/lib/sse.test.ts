import { describe, expect, it } from "vitest"

import { encodeSseFrame, readSseStream } from "./sse"

// Build a ReadableStream<Uint8Array> from string chunks (each chunk may contain
// part of a frame, all of a frame, or several frames) so we can prove the parser
// reassembles frames split across read boundaries.
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Array<{ event: string; data: unknown }>> {
  const frames: Array<{ event: string; data: unknown }> = []
  await readSseStream(stream, (event, data) => frames.push({ event, data }))
  return frames
}

describe("readSseStream", () => {
  it("parses a single complete frame", async () => {
    const frames = await collect(
      streamFromChunks([encodeSseFrame("token_delta", { text: "hi" })]),
    )
    expect(frames).toEqual([{ event: "token_delta", data: { text: "hi" } }])
  })

  it("reassembles a frame split across chunk boundaries", async () => {
    const frames = await collect(
      streamFromChunks([
        "event: result\nda",
        'ta: {"text":"done",',
        '"grounded":true}\n\n',
      ]),
    )
    expect(frames).toEqual([
      { event: "result", data: { text: "done", grounded: true } },
    ])
  })

  it("parses multiple frames delivered in one chunk", async () => {
    const frames = await collect(
      streamFromChunks([
        encodeSseFrame("token_delta", { text: "a" }) +
          encodeSseFrame("token_delta", { text: "b" }),
      ]),
    )
    expect(frames.map((f) => f.data)).toEqual([{ text: "a" }, { text: "b" }])
  })

  it("skips a frame with no data: line", async () => {
    const frames = await collect(streamFromChunks(["event: ping\n\n"]))
    expect(frames).toEqual([])
  })

  it("skips a frame whose data is not valid JSON", async () => {
    const frames = await collect(
      streamFromChunks([
        "event: error\ndata: not-json\n\n",
        encodeSseFrame("result", { text: "ok" }),
      ]),
    )
    expect(frames).toEqual([{ event: "result", data: { text: "ok" } }])
  })
})

describe("readSseStream — buffer cap", () => {
  it("rejects when a single separator-less frame exceeds the buffer cap", async () => {
    // > 512KB with no "\n\n" — a malformed/giant upstream frame must not buffer
    // unbounded; the parser throws so the caller maps it to a terminal failure.
    const huge = "x".repeat(600 * 1024)
    await expect(collect(streamFromChunks([huge]))).rejects.toThrow(
      /sse_buffer_overflow/,
    )
  })

  it("does NOT overflow on a single read of many complete frames past the cap", async () => {
    // The cap counts only the undrained tail — a big burst of well-formed
    // frames in one read drains fine even when its total length exceeds 512KB.
    const frames = Array.from({ length: 40_000 }, (_, i) =>
      encodeSseFrame("token_delta", { text: `t${i}` }),
    ).join("")
    expect(frames.length).toBeGreaterThan(512 * 1024)
    const out = await collect(streamFromChunks([frames]))
    expect(out).toHaveLength(40_000)
  })
})

describe("encodeSseFrame", () => {
  it("emits one event line, one JSON data line, and a blank-line terminator", () => {
    expect(encodeSseFrame("error", { reason: "timeout" })).toBe(
      'event: error\ndata: {"reason":"timeout"}\n\n',
    )
  })
})
