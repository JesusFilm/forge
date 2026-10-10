import { Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { createRequestListener, handleRequest } from "./server.js"

class TestResponse extends Writable {
  statusCode = 200
  headers: Record<string, string> = {}
  body = ""
  headersSent = false

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    this.body += chunk.toString()
    callback()
  }

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode
    this.headers = headers
    this.headersSent = true
    return this
  }
}

function request(
  method: string,
  url: string,
): Promise<{ statusCode: number; body: unknown }> {
  const response = new TestResponse()

  return handleRequest(
    { method, url, headers: {} } as never,
    response as never,
  ).then(() => ({
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  }))
}

describe("handleRequest", () => {
  it("serves unauthenticated health checks", async () => {
    await expect(request("GET", "/health")).resolves.toEqual({
      statusCode: 200,
      body: { ok: true, service: "crop-worker" },
    })
  })

  it("returns not found for unknown routes", async () => {
    await expect(request("POST", "/render")).resolves.toEqual({
      statusCode: 404,
      body: { error: "not_found" },
    })
  })
})

describe("createRequestListener", () => {
  const incoming = { method: "GET", url: "/jobs/wj_x", headers: {} } as never

  it("answers 500 internal_error when the handler rejects before writing", async () => {
    const listener = createRequestListener(async () => {
      throw new Error("route exploded")
    })
    const response = new TestResponse()

    await expect(listener(incoming, response as never)).resolves.toBeUndefined()
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({ error: "internal_error" })
  })

  it("never throws after headers are sent: destroys the response instead of double-writing", async () => {
    const listener = createRequestListener(async (_request, response) => {
      // Simulate a route that wrote a response and THEN failed.
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end('{"ok":true}')
      throw new Error("late failure")
    })
    const response = new TestResponse()

    // The listener must resolve (no rethrow, no unhandled rejection) ...
    await expect(listener(incoming, response as never)).resolves.toBeUndefined()
    // ... must not overwrite the already-sent status with a 500 ...
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"ok":true}')
    // ... and tears the socket down instead.
    expect(response.destroyed).toBe(true)
  })
})
