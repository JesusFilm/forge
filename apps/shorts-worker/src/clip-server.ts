// Loopback single-file static server for renders (plan decision 7).
// OffthreadVideo's ffmpeg path is CORS-exempt, but useWindowedAudioData
// (waveform) fetches from the browser — so the render downloads the clip to
// tmp and serves it here. Invariants (unit-tested):
//   - binds 127.0.0.1 explicitly, ephemeral port (listen on port 0)
//   - serves EXACTLY GET/HEAD /clip.mp4; 404s everything else
//   - single-range Range support (206 + Content-Range), suffix ranges work
//   - Access-Control-Allow-Origin: * (safe given the loopback bind)
//   - torn down in the caller's finally (close() below)

import { createReadStream, type Stats } from "node:fs"
import { stat } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"

export type ClipServer = {
  port: number
  /** http://127.0.0.1:{port}/clip.mp4 */
  url: string
  close(): Promise<void>
}

const CLIP_PATHNAME = "/clip.mp4"

type ByteRange = { start: number; end: number }

// Single-range parser. Returns null for "serve the full body" (no header or
// a multi-range/malformed header — ignoring Range is RFC-valid) and
// "unsatisfiable" for ranges past EOF (416).
export function parseRangeHeader(
  header: string | undefined,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === "" && rawEnd === "") return null

  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffixLength = Number(rawEnd)
    if (suffixLength === 0) return "unsatisfiable"
    const start = Math.max(0, size - suffixLength)
    return { start, end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return "unsatisfiable"
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return "unsatisfiable"
  return { start, end }
}

function handleRequest(
  filePath: string,
  stats: Stats,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const method = request.method ?? "GET"
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname

  if ((method !== "GET" && method !== "HEAD") || pathname !== CLIP_PATHNAME) {
    response.writeHead(404, { "Content-Type": "text/plain" })
    response.end("not found")
    return
  }

  const size = stats.size
  const baseHeaders = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  }

  const rangeHeader = Array.isArray(request.headers.range)
    ? request.headers.range[0]
    : request.headers.range
  const range = parseRangeHeader(rangeHeader, size)

  if (range === "unsatisfiable") {
    response.writeHead(416, {
      ...baseHeaders,
      "Content-Range": `bytes */${size}`,
    })
    response.end()
    return
  }

  if (range === null) {
    response.writeHead(200, {
      ...baseHeaders,
      "Content-Length": String(size),
    })
    if (method === "HEAD") {
      response.end()
      return
    }
    createReadStream(filePath).pipe(response)
    return
  }

  response.writeHead(206, {
    ...baseHeaders,
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    "Content-Length": String(range.end - range.start + 1),
  })
  if (method === "HEAD") {
    response.end()
    return
  }
  createReadStream(filePath, { start: range.start, end: range.end }).pipe(
    response,
  )
}

export async function startClipServer(filePath: string): Promise<ClipServer> {
  const stats = await stat(filePath)

  const server: Server = createServer((request, response) => {
    handleRequest(filePath, stats, request, response)
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    // Loopback bind + ephemeral port — never expose this server beyond the
    // local Chromium instance.
    server.listen(0, "127.0.0.1", () => resolve())
  })

  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new Error("clip server failed to bind a loopback TCP port")
  }

  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}${CLIP_PATHNAME}`,
    close() {
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
