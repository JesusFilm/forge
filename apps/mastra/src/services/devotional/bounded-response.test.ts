import { describe, expect, it } from "vitest"

import {
  readResponseJsonCapped,
  readResponseTextCapped,
} from "./bounded-response"

function streamedResponse(
  chunks: Uint8Array[],
  onCancel?: () => void,
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
      cancel: onCancel,
    }),
  )
}

describe("bounded response reads", () => {
  it("reassembles multiple chunks at the exact byte boundary", async () => {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('{"ok":'), encoder.encode("true}")]
    const maxBytes = chunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    )

    await expect(
      readResponseJsonCapped(streamedResponse(chunks), maxBytes),
    ).resolves.toEqual({ ok: true })
  })

  it("accepts near-cap three-byte script by bytes, not character count", async () => {
    const encoder = new TextEncoder()
    const maxBytes = 12 * 1024
    const text = "あ".repeat(Math.floor((maxBytes - 16) / 3))
    const bytes = encoder.encode(text)
    expect(bytes.byteLength).toBeGreaterThan(maxBytes - 32)

    await expect(
      readResponseTextCapped(streamedResponse([bytes]), maxBytes),
    ).resolves.toBe(text)
  })

  it("cancels the underlying stream immediately when the cap is crossed", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() {
        cancelled = true
      },
    })

    await expect(
      readResponseTextCapped(new Response(stream), 4096),
    ).resolves.toBeUndefined()
    expect(cancelled).toBe(true)
  })
})
