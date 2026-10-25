import { afterEach, describe, expect, it, vi } from "vitest"

import { readBodyLimited, readJsonLimited } from "./request"

function streamed(body: ReadableStream<Uint8Array>): Request {
  return new Request("https://feedback.example/upload", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit)
}

afterEach(() => vi.useRealTimers())

describe("bounded request bodies", () => {
  it("reads a valid chunked JSON request", async () => {
    const encoder = new TextEncoder()
    const request = streamed(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"ok":'))
          controller.enqueue(encoder.encode("true}"))
          controller.close()
        },
      }),
    )
    expect(await readJsonLimited(request)).toEqual({ ok: true })
  })

  it("rejects a streamed body exceeding its quota and cancels the source", async () => {
    const cancel = vi.fn()
    const request = streamed(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(9))
        },
        cancel,
      }),
    )
    await expect(readBodyLimited(request, 8)).rejects.toThrow(
      "request_too_large",
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("releases a stalled body without waiting for a stalled cancellation", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const request = streamed(new ReadableStream({ cancel }))
    const result = expect(readBodyLimited(request, 8, 100)).rejects.toThrow(
      "request_timeout",
    )
    await vi.advanceTimersByTimeAsync(100)
    await result
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.body?.locked).toBe(false)
  })

  it("rejects an oversized declared body before reading it", async () => {
    const request = new Request("https://feedback.example/upload", {
      method: "POST",
      headers: { "Content-Length": "100" },
      body: "x",
    })
    await expect(readBodyLimited(request, 8)).rejects.toThrow(
      "request_too_large",
    )
    expect(request.bodyUsed).toBe(false)
  })
})
