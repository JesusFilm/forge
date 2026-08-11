import { describe, expect, it, vi } from "vitest"

import { readBoundedSeoBody, SEO_ROUTE_BODY_LIMIT_BYTES } from "./route-utils"

describe("bounded SEO request bodies", () => {
  it("reads an ordinary chunked JSON body", async () => {
    const encoder = new TextEncoder()
    const request = new Request("https://admin.example/api/seo/ingest", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"action":'))
          controller.enqueue(encoder.encode('"start_run"}'))
          controller.close()
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    await expect(readBoundedSeoBody(request)).resolves.toBe(
      '{"action":"start_run"}',
    )
  })

  it("cancels a chunked body as soon as the byte limit is crossed", async () => {
    const cancelled = vi.fn()
    const request = new Request("https://admin.example/api/seo/ingest", {
      method: "POST",
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(
            new Uint8Array(Math.floor(SEO_ROUTE_BODY_LIMIT_BYTES / 2) + 1),
          )
        },
        cancel: cancelled,
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    await expect(readBoundedSeoBody(request)).rejects.toThrow(
      "Invalid SEO route body",
    )
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
