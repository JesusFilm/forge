import { Buffer } from "node:buffer"
import { URL } from "node:url"
const { Request, Response } = globalThis
import { createServer } from "node:http"
import { appendFile } from "node:fs/promises"

export function installLoopbackFetchGuard() {
  const original = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname !== "127.0.0.1")
      throw new Error(`Qualification forbids external fetch: ${url.origin}`)
    return original(input, init)
  }
}

export function serve(port, handlers, auditFile, resolveHandler = () => null) {
  return createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname
      const handler =
        handlers[`${req.method} ${path}`] ?? resolveHandler(req.method, path)
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body } : {}),
      })
      const response = handler
        ? await handler(request)
        : new Response("Not found", { status: 404 })
      const output = Buffer.from(await response.arrayBuffer())
      if (auditFile && path === "/mcp")
        await appendFile(
          auditFile,
          JSON.stringify({
            time: new Date().toISOString(),
            method: req.method,
            request: body.length ? JSON.parse(body.toString()) : null,
            status: response.status,
            response: output.length ? JSON.parse(output.toString()) : null,
          }) + "\n",
          { mode: 0o600 },
        )
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(output)
    } catch (error) {
      console.error(error)
      res.writeHead(500)
      res.end("Qualification handler failed")
    }
  }).listen(port, "127.0.0.1", () =>
    console.log(`Qualification listener ${port}`),
  )
}
