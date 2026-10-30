import { createRequire } from "node:module"
import net from "node:net"
import { once } from "node:events"
import { performance } from "node:perf_hooks"
const require = createRequire(
  new URL("../../../apps/admin/package.json", import.meta.url),
)
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const { Pool } = require("pg")

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/watch_q7n")
    throw new Error("Owned fixture only")
  const baselineOnly = process.argv.includes("--baseline-only")
  const responseDelayMs = 3
  const sockets = new Set<net.Socket>()
  const proxy = net.createServer((client) => {
    const upstream = net.connect({ host: url.hostname, port: Number(url.port) })
    sockets.add(client)
    sockets.add(upstream)
    client.on("data", (data) => upstream.write(data))
    upstream.on("data", (data) =>
      setTimeout(() => {
        if (!client.destroyed) client.write(data)
      }, responseDelayMs),
    )
    client.on("close", () => {
      sockets.delete(client)
      upstream.destroy()
    })
    upstream.on("close", () => {
      sockets.delete(upstream)
      client.destroy()
    })
    client.on("error", () => upstream.destroy())
    upstream.on("error", () => client.destroy())
  })
  proxy.listen(0, "127.0.0.1")
  await once(proxy, "listening")
  const address = proxy.address() as net.AddressInfo
  const delayed = new URL(url)
  delayed.port = String(address.port)
  const pool = new Pool({ connectionString: delayed.toString(), max: 10 })
  const db = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: [{ emit: "event", level: "query" }],
  })
  let sqlCount = 0
  db.$on("query", () => sqlCount++)
  const languageId = "q7n-language"
  const keys = Array.from({ length: 62 }, (_, i) => ({
    videoId: `q7n-video-${i}`,
    languageId,
  }))
  const query = {
    select: {
      id: true,
      duration: true,
      hls: true,
      language: { select: { id: true, slug: true } },
    },
  }
  const scalar = (key: (typeof keys)[number]) =>
    db.videoDub.findFirst({
      ...query,
      where: {
        ...key,
        deletedAt: null,
        published: true,
        OR: [
          { hls: { not: null } },
          { dash: { not: null } },
          { share: { not: null } },
        ],
        video: { deletedAt: null },
      },
      orderBy: [{ duration: "desc" }, { id: "asc" }],
    })
  try {
    await db.language.upsert({
      where: { id: languageId },
      create: { id: languageId, coreId: languageId, slug: languageId },
      update: {},
    })
    await db.video.createMany({
      data: keys.map((k) => ({
        id: k.videoId,
        coreId: k.videoId,
        slug: k.videoId,
      })),
      skipDuplicates: true,
    })
    await db.videoDub.createMany({
      data: keys.flatMap((k) =>
        [1, 2].map((n) => ({
          id: `${k.videoId}-dub-${n}`,
          coreId: `${k.videoId}-dub-${n}`,
          videoId: k.videoId,
          languageId,
          duration: n * 30,
          published: true,
          hls: "https://fixture.invalid/stream.m3u8",
        })),
      ),
      skipDuplicates: true,
    })
    const loaders = baselineOnly
      ? null
      : await import("../../../apps/admin/src/graphql/loaders")
    const runRequest = async (mode: string) => {
      if (mode === "scalar") return Promise.all(keys.map(scalar))
      const loader = loaders!.createLoaders(db).selectedBlockVideoDub
      return Promise.all(keys.map((key) => loader.load({ ...key, query })))
    }
    for (const mode of baselineOnly
      ? ["scalar"]
      : ["scalar", "batch", "batch", "scalar"]) {
      await Promise.all(
        Array.from({ length: 10 }, () => db.$queryRawUnsafe("SELECT 1")),
      )
      await runRequest(mode)
      const rounds = []
      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        sqlCount = 0
        let pendingMax = 0
        const timer = setInterval(() => {
          pendingMax = Math.max(pendingMax, pool.waitingCount)
        }, 1)
        const requests = Promise.all(
          Array.from({ length: 5 }, () => runRequest(mode)),
        )
        await new Promise((resolve) => setTimeout(resolve, 5))
        const probeStart = performance.now()
        await db.$queryRawUnsafe("SELECT 1 AS value")
        const probeMs = performance.now() - probeStart
        const rows = await requests
        clearInterval(timer)
        if (rows.some((r) => JSON.stringify(r) !== JSON.stringify(rows[0])))
          throw new Error("Request result mismatch")
        if (
          rows[0].some(
            (r: { id: string } | null, index: number) =>
              r?.id !== `${keys[index].videoId}-dub-2`,
          )
        )
          throw new Error("Wrong winner")
        rounds.push({
          probeMs,
          wallMs: performance.now() - start,
          pendingMax,
          sqlCount,
        })
      }
      const summarize = (key: keyof (typeof rounds)[number]) => {
        const v = rounds.map((r) => r[key]).sort((a, b) => a - b)
        return { min: v[0], p50: v[9], p95: v[18], max: v[19] }
      }
      console.log(
        JSON.stringify({
          mode,
          responseDelayMs,
          poolLimit: 10,
          requestsPerRound: 5,
          lookupsPerRequest: 62,
          rounds: 20,
          probe: summarize("probeMs"),
          workload: summarize("wallMs"),
          pending: summarize("pendingMax"),
          queries: summarize("sqlCount"),
        }),
      )
    }
  } finally {
    await db.$disconnect()
    await pool.end()
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => proxy.close(resolve))
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
