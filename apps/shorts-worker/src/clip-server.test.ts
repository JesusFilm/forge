import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  parseRangeHeader,
  startClipServer,
  type ClipServer,
} from "./clip-server.js"

describe("parseRangeHeader", () => {
  it("parses a bounded single range", () => {
    expect(parseRangeHeader("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 })
  })

  it("parses an open-ended range to EOF", () => {
    expect(parseRangeHeader("bytes=900-", 1000)).toEqual({
      start: 900,
      end: 999,
    })
  })

  it("parses a suffix range (last N bytes)", () => {
    expect(parseRangeHeader("bytes=-100", 1000)).toEqual({
      start: 900,
      end: 999,
    })
    // Suffix longer than the file clamps to the whole file.
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({
      start: 0,
      end: 999,
    })
  })

  it("clamps end past EOF", () => {
    expect(parseRangeHeader("bytes=10-99999", 1000)).toEqual({
      start: 10,
      end: 999,
    })
  })

  it("treats multi-range and malformed headers as full-body (RFC-valid ignore)", () => {
    expect(parseRangeHeader("bytes=0-1,5-9", 1000)).toBeNull()
    expect(parseRangeHeader("chunks=0-1", 1000)).toBeNull()
    expect(parseRangeHeader(undefined, 1000)).toBeNull()
  })

  it("flags ranges past EOF as unsatisfiable", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toBe("unsatisfiable")
    expect(parseRangeHeader("bytes=5-2", 1000)).toBe("unsatisfiable")
    expect(parseRangeHeader("bytes=-0", 1000)).toBe("unsatisfiable")
  })
})

describe("startClipServer", () => {
  let dir: string
  let server: ClipServer
  const payload = Buffer.from("0123456789abcdef")

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "shorts-worker-clip-server-"))
    const filePath = join(dir, "clip.mp4")
    await writeFile(filePath, payload)
    server = await startClipServer(filePath)
  })

  afterEach(async () => {
    await server.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  it("binds 127.0.0.1 explicitly on an ephemeral port", () => {
    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/clip.mp4`)
  })

  it("serves the full file with CORS + Accept-Ranges headers", async () => {
    const response = await fetch(server.url)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("video/mp4")
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(payload)
  })

  it("serves 206 partial content for a single Range", async () => {
    const response = await fetch(server.url, {
      headers: { Range: "bytes=4-7" },
    })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(
      `bytes 4-7/${payload.byteLength}`,
    )
    expect(response.headers.get("content-length")).toBe("4")
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "4567",
    )
  })

  it("serves suffix ranges", async () => {
    const response = await fetch(server.url, {
      headers: { Range: "bytes=-4" },
    })
    expect(response.status).toBe(206)
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "cdef",
    )
  })

  it("answers 416 for unsatisfiable ranges", async () => {
    const response = await fetch(server.url, {
      headers: { Range: `bytes=${payload.byteLength}-` },
    })
    expect(response.status).toBe(416)
    expect(response.headers.get("content-range")).toBe(
      `bytes */${payload.byteLength}`,
    )
  })

  it("supports HEAD", async () => {
    const response = await fetch(server.url, { method: "HEAD" })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-length")).toBe(
      String(payload.byteLength),
    )
  })

  it("404s every other path (single mapped file only)", async () => {
    const base = `http://127.0.0.1:${server.port}`
    for (const path of [
      "/etc/passwd",
      "/../etc/passwd",
      "/clip.mp4x",
      "/",
      "/clip.mp4/extra",
    ]) {
      const response = await fetch(`${base}${path}`)
      expect(response.status, path).toBe(404)
    }
  })

  it("404s non-GET/HEAD methods", async () => {
    const response = await fetch(server.url, { method: "POST" })
    expect(response.status).toBe(404)
  })
})
