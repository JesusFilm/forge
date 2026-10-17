import { createServer, type Server, type RequestListener } from "node:http"
import { afterEach, expect, test } from "vitest"
import { studioRenderHttp } from "./studio-render-http"

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }),
  )
})
async function listen(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Missing address")
  return new URL(`http://127.0.0.1:${address.port}/render`)
}

test("silent header wait and streaming gaps are governed by caller deadline", async () => {
  const url = await listen((_request, response) => {
    setTimeout(() => {
      response.writeHead(200)
      response.write("first")
      setTimeout(() => response.end("second"), 60)
    }, 60)
  })
  const response = await studioRenderHttp(url, {
    signal: AbortSignal.timeout(1000),
  })
  expect(await response.text()).toBe("firstsecond")
})

test("caller deadline closes an execution still waiting for headers", async () => {
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve
  })
  const url = await listen((request) => {
    request.on("close", closed)
  })
  await expect(
    studioRenderHttp(url, { signal: AbortSignal.timeout(50) }),
  ).rejects.toThrow()
  await disconnected
})

test("parent cancellation closes execution after headers while reading output", async () => {
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve
  })
  const url = await listen((request, response) => {
    request.on("close", closed)
    response.writeHead(200)
    response.write("partial")
  })
  const controller = new AbortController()
  const response = await studioRenderHttp(url, { signal: controller.signal })
  const body = response.text()
  controller.abort()
  await expect(body).rejects.toThrow()
  await disconnected
})

test("redirect targets are never requested", async () => {
  let targetRequests = 0
  const target = await listen((_request, response) => {
    targetRequests++
    response.end("secret")
  })
  const url = await listen((_request, response) => {
    response.writeHead(307, { location: target.toString() })
    response.end()
  })
  await expect(
    studioRenderHttp(url, { signal: AbortSignal.timeout(1000) }),
  ).rejects.toThrow("redirect")
  expect(targetRequests).toBe(0)
})

test("bounded-reader cancellation tears down the native response socket", async () => {
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve
  })
  const url = await listen((request, response) => {
    request.on("close", closed)
    response.writeHead(200)
    response.write("exceeds-reader-budget")
  })
  const response = await studioRenderHttp(url, {
    signal: AbortSignal.timeout(1000),
  })
  const reader = response.body!.getReader()
  const chunk = await reader.read()
  expect(chunk.value!.byteLength).toBeGreaterThan(4)
  await reader.cancel("response byte limit")
  reader.releaseLock()
  await disconnected
})
