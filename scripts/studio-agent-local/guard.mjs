/** Qualification-only preload, inherited by Next workers. Never deployed/imported by apps. */
import net from "node:net"
import { syncBuiltinESMExports } from "node:module"
import { readFileSync, appendFileSync } from "node:fs"

const manifestPath = process.env.STUDIO_QUALIFICATION_MANIFEST
if (!manifestPath?.startsWith("/"))
  throw new Error("Private fixture manifest required")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args
  const first = normalized[0]
  const host =
    typeof first === "object"
      ? first.host
      : typeof normalized[1] === "string"
        ? normalized[1]
        : "localhost"
  if (
    (typeof first === "object" && first.path) ||
    (typeof first === "string" && !/^\d+$/.test(first))
  )
    throw new Error("Qualification forbids Unix socket connections")
  if (!["127.0.0.1", "::1", "localhost"].includes(host ?? "localhost"))
    throw new Error("Qualification forbids external socket connections")
  return originalConnect.apply(this, args)
}
syncBuiltinESMExports()
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    return originalFetch(input, init)
  const fixture = manifest.responses.find(
    (entry) => entry.url === request.url && entry.method === request.method,
  )
  if (!fixture)
    throw new Error("Qualification forbids unregistered external fetch")
  const body = request.method === "POST" ? await request.text() : null
  appendFileSync(
    manifest.audit,
    JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      fixture: fixture.name,
      body,
    }) + "\n",
    { mode: 0o600 },
  )
  return new Response(readFileSync(fixture.file), {
    status: 200,
    headers: fixture.headers,
  })
}
