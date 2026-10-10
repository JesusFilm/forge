import { UsageError } from "../../contracts/consumer-usage.js"
import { expect, it } from "vitest"
import { serve } from "@hono/node-server"
import { createApp } from "./app.js"
import { MemoryUsageStore } from "../../fakes/consumer-usage.js"
import { UsageCollector } from "./usage.js"

it("counts completed HTTP attempts, errors, and denies without attributing revoked credentials", async () => {
  const store = new MemoryUsageStore()
  const collector = new UsageCollector(store)
  let active = true
  let retrievalFails = false
  const app = createApp({
    retriever: {
      search: async () => {
        if (retrievalFails) throw new UsageError("unavailable")
        return []
      },
    },
    consumerAuth: {
      authenticate: async () =>
        active
          ? {
              consumerId: "00000000-0000-4000-8000-000000000528",
              allowedSourceKeys: ["synthetic"],
            }
          : null,
    },
    usage: collector,
  })
  const server = serve({ fetch: app.fetch, port: 0 })
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  )
  const address = server.address()
  if (!address || typeof address === "string")
    throw new UsageError("unavailable")
  const request = (body: string) =>
    fetch(`http://127.0.0.1:${address.port}/v1/search`, {
      method: "POST",
      headers: { authorization: "Bearer rag_synthetic" },
      body,
    })
  try {
    for (let i = 0; i < 3; i++)
      expect((await request('{"query":"synthetic"}')).status).toBe(200)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 3, successes: 3 })
    for (let i = 0; i < 2; i++) await request('{"query":"synthetic"}')
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 5, successes: 5 })
    expect((await request("invalid")).status).toBe(400)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 6, successes: 5 })
    active = false
    expect((await request("{}")).status).toBe(401)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 6, successes: 5 })
    active = true
    retrievalFails = true
    expect((await request('{"query":"synthetic"}')).status).toBe(500)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 7, successes: 5 })
    expect((await request("x".repeat(17 * 1024))).status).toBe(413)
    expect(
      (await fetch(`http://127.0.0.1:${address.port}/v1/health`)).status,
    ).toBe(200)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 7, successes: 5 })
    retrievalFails = false
    expect((await request('{"query":"synthetic"}')).status).toBe(200)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 8, successes: 6 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.stop()
  }
})

it("does not count a disconnected retrieval as successful", async () => {
  const { request: httpRequest } = await import("node:http")
  const store = new MemoryUsageStore(),
    collector = new UsageCollector(store)
  let started!: () => void, release!: () => void
  const admitted = new Promise<void>((resolve) => {
    started = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const app = createApp({
    consumerAuth: {
      authenticate: async () => ({
        consumerId: "00000000-0000-4000-8000-000000000528",
        allowedSourceKeys: ["synthetic"],
      }),
    },
    retriever: {
      search: async () => {
        started()
        await waiting
        return []
      },
    },
    usage: collector,
  })
  const server = serve({ fetch: app.fetch, port: 0 })
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  )
  const address = server.address()
  if (!address || typeof address === "string")
    throw new UsageError("unavailable")
  try {
    const req = httpRequest(`http://127.0.0.1:${address.port}/v1/search`, {
      method: "POST",
      headers: { authorization: "Bearer rag_synthetic" },
    })
    req.on("error", () => {})
    req.end('{"query":"synthetic"}')
    await admitted
    req.destroy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 1, successes: 0 })
  } finally {
    release()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.stop()
  }
})

it("a failed accounting write does not block retrieval or prevent subsequent counting", async () => {
  const { vi } = await import("vitest")
  const store = new MemoryUsageStore()
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(store, "admit").mockRejectedValueOnce(
    new Error("synthetic write failure"),
  )
  const collector = new UsageCollector(store)
  const app = createApp({
    retriever: { search: async () => [] },
    consumerAuth: {
      authenticate: async () => ({
        consumerId: "00000000-0000-4000-8000-000000000528",
        allowedSourceKeys: [],
      }),
    },
    usage: collector,
  })
  const server = serve({ fetch: app.fetch, port: 0 })
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  )
  const address = server.address()
  if (!address || typeof address === "string")
    throw new UsageError("unavailable")
  try {
    const request = () =>
      fetch(`http://127.0.0.1:${address.port}/v1/search`, {
        method: "POST",
        headers: { authorization: "Bearer rag_synthetic" },
        body: '{"query":"synthetic"}',
      })
    expect((await request()).status).toBe(200)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 0, successes: 0 })
    expect(log).toHaveBeenCalledWith("[rag] event=usage_unavailable")
    expect((await request()).status).toBe(200)
    await collector.flush()
    expect(store.totals()).toEqual({ requests: 1, successes: 1 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await collector.stop()
    log.mockRestore()
    vi.restoreAllMocks()
  }
})
