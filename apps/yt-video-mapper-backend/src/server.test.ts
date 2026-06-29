import { Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { createServerRuntime, handleRequest } from "./server.js"
import type { MatchJobService } from "./services/match-job.service.js"

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

  return handleRequest({ method, url } as never, response as never).then(
    () => ({
      statusCode: response.statusCode,
      body: JSON.parse(response.body),
    }),
  )
}

describe("handleRequest", () => {
  it("serves health checks", async () => {
    await expect(request("GET", "/health")).resolves.toEqual({
      statusCode: 200,
      body: { ok: true, service: "yt-video-mapper-backend" },
    })
  })

  it("returns not found for unknown routes", async () => {
    await expect(request("POST", "/match")).resolves.toEqual({
      statusCode: 404,
      body: { error: "not_found" },
    })
  })

  it("starts the match job worker with the route service", () => {
    const service = {} as MatchJobService
    const stop = vi.fn()
    const startedWith: MatchJobService[] = []

    const runtime = createServerRuntime({
      matchJobService: service,
      workerEnabled: true,
      startMatchJobWorkerImpl: (matchJobService) => {
        startedWith.push(matchJobService)
        return { stop }
      },
    })

    expect(runtime.worker).toEqual({ stop })
    expect(startedWith).toEqual([service])
  })

  it("can disable the match job worker", () => {
    const startMatchJobWorkerImpl = vi.fn()

    const runtime = createServerRuntime({
      matchJobService: {} as MatchJobService,
      workerEnabled: false,
      startMatchJobWorkerImpl,
    })

    expect(runtime.worker).toBeNull()
    expect(startMatchJobWorkerImpl).not.toHaveBeenCalled()
  })
})
