import { Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { handleRequest } from "./server.js"

class TestResponse extends Writable {
  statusCode = 200
  headers: Record<string, string> = {}
  body = ""

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
