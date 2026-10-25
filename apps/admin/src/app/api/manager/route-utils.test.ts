import { describe, expect, it, vi } from "vitest"

import {
  MANAGER_API_MAX_BODY_BYTES,
  readBoundedManagerJson,
} from "./route-utils"

describe("bounded Manager API JSON", () => {
  it("accepts JSON at the exact byte ceiling", async () => {
    const body = JSON.stringify("x".repeat(MANAGER_API_MAX_BODY_BYTES - 2))
    expect(new TextEncoder().encode(body)).toHaveLength(
      MANAGER_API_MAX_BODY_BYTES,
    )
    await expect(readBoundedManagerJson(request(body))).resolves.toBe(
      "x".repeat(MANAGER_API_MAX_BODY_BYTES - 2),
    )
  })

  it("cancels a streamed body at one byte over the ceiling", async () => {
    const cancel = vi.fn()
    const exact = JSON.stringify("x".repeat(MANAGER_API_MAX_BODY_BYTES - 2))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(exact))
        controller.enqueue(new TextEncoder().encode(" "))
      },
      cancel,
    })
    await expect(
      readBoundedManagerJson(
        new Request("http://localhost:3003/api/manager/session", {
          method: "POST",
          body: stream,
          duplex: "half",
        } as RequestInit),
      ),
    ).rejects.toThrow(/too_large/)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

function request(body: string) {
  return new Request("http://localhost:3003/api/manager/session", {
    method: "POST",
    body,
  })
}
