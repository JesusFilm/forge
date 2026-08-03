import { describe, expect, it } from "vitest"

import { readJsonBodyCapped, readTextBodyCapped } from "./read-body"

/**
 * Byte-cap MECHANISM tests (repo law): a real ReadableStream whose `cancel()`
 * sets a flag, so the test proves the socket-side abort — not just the
 * `undefined` return value.
 */
function streamResponse(input: {
  chunks: Uint8Array[]
  /** When true the stream never ends on its own — only cancel stops it. */
  endless?: boolean
  onCancel: () => void
}): Response {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < input.chunks.length) {
        controller.enqueue(input.chunks[index])
        index += 1
        return
      }
      if (input.endless) {
        controller.enqueue(new Uint8Array(1024))
        return
      }
      controller.close()
    },
    cancel() {
      input.onCancel()
    },
  })
  return new Response(stream)
}

const encoder = new TextEncoder()

describe("readJsonBodyCapped", () => {
  it("parses an under-cap JSON body without cancelling", async () => {
    let cancelled = false
    const response = streamResponse({
      chunks: [encoder.encode('{"ok":true}')],
      onCancel: () => {
        cancelled = true
      },
    })
    await expect(readJsonBodyCapped(response, 1024)).resolves.toEqual({
      ok: true,
    })
    expect(cancelled).toBe(false)
  })

  it("aborts the underlying stream the moment the counter crosses the cap", async () => {
    let cancelled = false
    const response = streamResponse({
      chunks: [],
      endless: true,
      onCancel: () => {
        cancelled = true
      },
    })
    await expect(readJsonBodyCapped(response, 4096)).resolves.toBeUndefined()
    expect(cancelled).toBe(true)
  })

  it("does not trust Content-Length — the counter decides", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2048))
      },
      cancel() {
        cancelled = true
      },
    })
    // Claims 10 bytes; streams forever.
    const response = new Response(stream, {
      headers: { "content-length": "10" },
    })
    await expect(readJsonBodyCapped(response, 4096)).resolves.toBeUndefined()
    expect(cancelled).toBe(true)
  })

  it("returns undefined for a non-JSON body instead of throwing", async () => {
    const response = streamResponse({
      chunks: [encoder.encode("not json at all")],
      onCancel: () => {},
    })
    await expect(readJsonBodyCapped(response, 1024)).resolves.toBeUndefined()
  })

  it("decodes multi-byte scripts correctly under the cap", async () => {
    // 3-bytes-per-code-unit worst case (repo sizing corollary): a Japanese
    // payload near the cap must parse, not false-fail.
    const text = "あ".repeat(100)
    const body = JSON.stringify({ text })
    const response = streamResponse({
      chunks: [encoder.encode(body)],
      onCancel: () => {},
    })
    // Cap sized in BYTES: 100 chars x 3 bytes + JSON envelope.
    await expect(
      readJsonBodyCapped(response, encoder.encode(body).byteLength),
    ).resolves.toEqual({ text })
  })

  it("returns undefined when the body is absent", async () => {
    await expect(
      readJsonBodyCapped(new Response(null), 1024),
    ).resolves.toBeUndefined()
  })
})

describe("readTextBodyCapped", () => {
  it("returns the text under the cap and undefined over it", async () => {
    let cancelled = false
    const under = streamResponse({
      chunks: [encoder.encode("error detail")],
      onCancel: () => {},
    })
    await expect(readTextBodyCapped(under, 1024)).resolves.toBe("error detail")

    const over = streamResponse({
      chunks: [],
      endless: true,
      onCancel: () => {
        cancelled = true
      },
    })
    await expect(readTextBodyCapped(over, 2048)).resolves.toBeUndefined()
    expect(cancelled).toBe(true)
  })
})
