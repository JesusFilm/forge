import http from "node:http"
import { gzipSync } from "node:zlib"
import { randomBytes, timingSafeEqual, createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { studioPreviewSchema } from "@forge/studio-contracts/preview"

class StudioPreviewHostError extends Error {}

const config = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3460),
    STUDIO_PREVIEW_API_KEY: z.string().min(32),
    STUDIO_PREVIEW_PUBLIC_ORIGIN: z.string().url(),
    STUDIO_MANAGER_ORIGIN: z.string().url(),
  })
  .parse(process.env)
const origin = new URL(config.STUDIO_PREVIEW_PUBLIC_ORIGIN).origin,
  managerOrigin = new URL(config.STUDIO_MANAGER_ORIGIN).origin
const sessions = new Map<
  string,
  {
    expires: number
    files: Map<string, { bytes: Buffer; type: string }>
    bytes: number
  }
>()
const bundle = await readFile(
  fileURLToPath(new URL("./client.js", import.meta.url)),
)
const compressedBundle = gzipSync(bundle)
const bundleVersion = createHash("sha256")
  .update(bundle)
  .digest("hex")
  .slice(0, 16)
const MAX_BYTES = 256 * 1024 * 1024,
  MAX_TOTAL = 512 * 1024 * 1024
function allowed(req: http.IncomingMessage) {
  const actual = Buffer.from(req.headers.authorization ?? ""),
    expected = Buffer.from(`Bearer ${config.STUDIO_PREVIEW_API_KEY}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function headers(res: http.ServerResponse) {
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("Origin-Agent-Cluster", "?1")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src ${origin} 'unsafe-eval'; style-src 'unsafe-inline'; img-src ${origin} blob: data:; media-src ${origin} blob:; connect-src ${origin}; font-src 'none'; frame-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors ${managerOrigin}`,
  )
}
function expire() {
  for (const [key, value] of sessions)
    if (value.expires < Date.now()) sessions.delete(key)
}
async function body(req: http.IncomingMessage, max: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const data of req) {
    const b = Buffer.from(data)
    size += b.length
    if (size > max)
      throw new StudioPreviewHostError("Upload exceeds preview budget")
    chunks.push(b)
  }
  return Buffer.concat(chunks)
}
let receiving = false
const server = http.createServer(async (req, res) => {
  headers(res)
  let ownsReceiver = false
  try {
    if (req.method === "POST" || req.method === "PUT") {
      if (receiving) {
        res.writeHead(429).end()
        return
      }
      receiving = true
      ownsReceiver = true
    }
    expire()
    const url = new URL(req.url ?? "/", origin),
      parts = url.pathname.split("/")
    if (req.method === "POST" && url.pathname === "/sessions") {
      if (!allowed(req)) {
        res.writeHead(401).end()
        return
      }
      if (sessions.size >= 8) {
        res.writeHead(429).end()
        return
      }
      const input = studioPreviewSchema.parse(
        JSON.parse((await body(req, 1048576)).toString()),
      )
      const token = randomBytes(32).toString("hex"),
        bytes = Buffer.from(JSON.stringify(input))
      sessions.set(token, {
        expires: Date.now() + 15 * 60000,
        files: new Map([["input.json", { bytes, type: "application/json" }]]),
        bytes: bytes.length,
      })
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ token, url: `${origin}/s/${token}/` }))
      return
    }
    if (parts[1] === "s" && /^[a-f0-9]{64}$/.test(parts[2] ?? "")) {
      if (req.method === "DELETE") {
        if (!allowed(req)) {
          res.writeHead(401).end()
          return
        }
        sessions.delete(parts[2]!)
        res.writeHead(204).end()
        return
      }
      const session = sessions.get(parts[2]!)
      if (!session) {
        res.writeHead(410).end()
        return
      }
      if (req.method === "PATCH") {
        if (!allowed(req)) {
          res.writeHead(401).end()
          return
        }
        session.expires = Date.now() + 15 * 60000
        res.writeHead(204).end()
        return
      }
      const file = parts[3] ?? ""
      if (req.method === "PUT") {
        if (!allowed(req)) {
          res.writeHead(401).end()
          return
        }
        if (
          !/^[a-zA-Z0-9._-]{1,160}$/.test(file) ||
          file === "input.json" ||
          session.files.has(file) ||
          session.files.size >= 256
        ) {
          res.writeHead(400).end()
          return
        }
        const data = await body(
          req,
          Math.min(
            MAX_BYTES - session.bytes,
            MAX_TOTAL - [...sessions.values()].reduce((n, s) => n + s.bytes, 0),
          ),
        )
        session.bytes += data.length
        session.files.set(file, {
          bytes: data,
          type: String(
            req.headers["content-type"] ?? "application/octet-stream",
          ),
        })
        res.writeHead(201).end()
        return
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end()
        return
      }
      if (file === "") {
        res.setHeader("Content-Type", "text/html")
        res.end(
          `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><div id="root"></div><script src="/client.js?v=${bundleVersion}" defer></script></body></html>`,
        )
        return
      }
      const asset = session.files.get(file)
      if (!asset) {
        res.writeHead(404).end()
        return
      }
      res.setHeader("Content-Type", asset.type)
      res.setHeader("Accept-Ranges", "bytes")
      const length = asset.bytes.length
      // Resolve the authorized, unexpired session and exact retained file before
      // examining Range. One zero-copy slice keeps response memory bounded.
      // HTTP Range applies to GET; HEAD describes the complete representation.
      const range = req.method === "GET" ? req.headers.range : undefined
      if (range !== undefined) {
        const match =
          range.length <= 80 ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
        const first = match?.[1] ?? "",
          last = match?.[2] ?? ""
        const start = first ? Number(first) : Math.max(0, length - Number(last))
        const end =
          first && last ? Math.min(Number(last), length - 1) : length - 1
        if (
          !match ||
          (!first && !last) ||
          (!first && Number(last) === 0) ||
          (first && !Number.isSafeInteger(Number(first))) ||
          (last && !Number.isSafeInteger(Number(last))) ||
          start >= length ||
          start > end
        ) {
          res.setHeader("Content-Range", `bytes */${length}`)
          res.writeHead(416).end()
          return
        }
        res.setHeader("Content-Range", `bytes ${start}-${end}/${length}`)
        res.setHeader("Content-Length", end - start + 1)
        res.writeHead(206).end(asset.bytes.subarray(start, end + 1))
        return
      }
      res.setHeader("Content-Length", length)
      res.end(req.method === "HEAD" ? undefined : asset.bytes)
      return
    }
    if (req.method === "GET" && url.pathname === "/client.js") {
      res.setHeader("Content-Type", "text/javascript")
      res.setHeader("Cache-Control", "public,max-age=3600")
      res.setHeader("Vary", "Accept-Encoding")
      if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
        res.setHeader("Content-Encoding", "gzip")
        res.end(compressedBundle)
      } else res.end(bundle)
      return
    }
    res.writeHead(404).end()
  } catch {
    if (!res.headersSent) res.writeHead(400)
    res.end("Preview request rejected")
  } finally {
    if (ownsReceiver) receiving = false
  }
})
server.requestTimeout = 30000
server.headersTimeout = 10000
server.listen(config.PORT, "0.0.0.0")
setInterval(expire, 30000).unref()
