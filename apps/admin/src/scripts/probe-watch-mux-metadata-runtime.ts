import { createServer } from "node:http"
import { Worker } from "node:worker_threads"
import { randomUUID } from "node:crypto"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import tracer from "dd-trace"
import { env } from "@/config/env"
import { stripEmbeddingFromResult } from "@/db/client"
import {
  getOrCreateWatchChapterCarouselMuxBlurDataUrl,
  getOrCreateWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchChapterCarouselMuxBlurDataUrl,
  getOrScheduleWatchChapterCarouselMuxDominantColor,
  getOrScheduleWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchHeroPosterMuxDominantColor,
  getOrScheduleWatchMuxImageMetadata,
} from "@/services/mux-image-derivative.service"

/** Local-only control/treatment of the observed 192-video, 384-row recipe batch. */
async function main() {
  const url = env.DATABASE_URL
  if (new URL(url).hostname !== "127.0.0.1") throw Error("local only")
  new tracer.TracerProvider().register()
  const baseline = process.argv.includes("--baseline")
  const burst = process.argv.includes("--burst")
  const schema = `watch_mux_probe_${randomUUID().replaceAll("-", "")}`
  const db = new Client({ connectionString: url })
  await db.connect()
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 10 }, { schema }),
  })
  const prisma = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return stripEmbeddingFromResult(await query({ ...args }))
        },
      },
    },
  }) as unknown as PrismaClient
  const videos = Array.from({ length: 192 }, (_, i) => ({
    muxVideoId: `mux-${i + 1}`,
    playbackId: `playback-${i + 1}`,
  }))
  const originalFetch = globalThis.fetch
  const loop = monitorEventLoopDelay({ resolution: 10 })
  let worker: Worker | undefined
  let server: ReturnType<typeof createServer> | undefined
  try {
    await db.query(`CREATE SCHEMA "${schema}";
      CREATE TABLE "${schema}".mux_image_derivative (
        id text PRIMARY KEY, mux_video_id text NOT NULL, purpose text NOT NULL,
        params_hash text NOT NULL, params jsonb NOT NULL DEFAULT '{}',
        source_url text NOT NULL, lqip_url text NOT NULL,
        blur_data_url text NOT NULL, dominant_color text,
        generated_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL,
        UNIQUE(mux_video_id, purpose, params_hash)
      )`)
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#336699"/></svg>',
    )
    globalThis.fetch = async () =>
      new Response(bytes, {
        headers: { "content-type": "image/svg+xml" },
      })
    for (const generate of [
      getOrCreateWatchChapterCarouselMuxBlurDataUrl,
      getOrCreateWatchHeroPosterMuxBlurDataUrl,
    ])
      await generate({ prisma, muxVideoId: "seed", playbackId: "seed" })
    globalThis.fetch = originalFetch
    await db.query(`INSERT INTO "${schema}".mux_image_derivative
      SELECT 'fixture-' || n || purpose, 'mux-' || n, purpose, params_hash,
        params, source_url, lqip_url, repeat('a', 400), '#123456',
        generated_at, created_at, updated_at
      FROM "${schema}".mux_image_derivative CROSS JOIN generate_series(1,192) n
      WHERE mux_video_id = 'seed'`)
    const catalog: number[] = [],
      transactions: number[] = []
    server = createServer((_request, response) => {
      const at = performance.now()
      void prisma
        .$transaction(async (tx) => {
          // Selection performs several dependent reads/writes after its lock.
          // Eight trivial round trips isolate scheduling from SQL/lock cost.
          for (let statement = 0; statement < 8; statement++) {
            await tx.$queryRaw`SELECT 1`
          }
        })
        .then(
          () => {
            transactions.push(performance.now() - at)
            response.end("ok")
          },
          () => {
            response.statusCode = 500
            response.end("query failed")
          },
        )
    })
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    )
    const address = server.address()
    if (!address || typeof address === "string")
      throw Error("missing local port")
    worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      let stopped = false;
      parentPort.on('message', () => { stopped = true });
      (async () => {
        const samples = [];
        const warm = await fetch('http://127.0.0.1:' + workerData.port, {signal: AbortSignal.timeout(5000)});
        await warm.text();
        if (warm.status !== 200) throw Error('warm probe HTTP failure');
        parentPort.postMessage('ready');
        while (!stopped) {
          const start = performance.now();
          const response = await fetch('http://127.0.0.1:' + workerData.port, {signal: AbortSignal.timeout(5000)});
          await response.text();
          if (response.status !== 200) throw Error('probe HTTP failure');
          samples.push(performance.now() - start);
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        parentPort.postMessage(samples);
        parentPort.close();
      })().catch(error => { throw error });
    `,
      { eval: true, workerData: { port: address.port } },
    )
    const ready = new Promise<void>((resolve, reject) => {
      worker!.once("message", () => resolve())
      worker!.once("error", reject)
    })
    const external = new Promise<number[]>((resolve, reject) => {
      worker!.on("message", (value) => {
        if (Array.isArray(value)) resolve(value)
      })
      worker!.once("error", reject)
    })
    // The result is awaited after the load; mark early rejection as handled.
    void external.catch(() => {})
    // Warm the independent probe transport before the catalog workload begins.
    await ready
    loop.enable()
    const start = performance.now()
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let round = 0; round < 20; round++) {
          const at = performance.now()
          await tracer.trace("watch.catalog.metadata", async () => {
            if (baseline) {
              const values = await Promise.all(
                videos.map(async (video) => {
                  const args = { prisma, ...video }
                  return Promise.all([
                    getOrScheduleWatchChapterCarouselMuxBlurDataUrl(args),
                    getOrScheduleWatchChapterCarouselMuxDominantColor(args),
                    getOrScheduleWatchHeroPosterMuxBlurDataUrl(args),
                    getOrScheduleWatchHeroPosterMuxDominantColor(args),
                  ])
                }),
              )
              if (
                values.some(
                  (row) =>
                    row[0]?.length !== 400 ||
                    row[1] !== "#123456" ||
                    row[2]?.length !== 400 ||
                    row[3] !== "#123456",
                )
              ) {
                throw Error("baseline output differs")
              }
            } else {
              const values = await getOrScheduleWatchMuxImageMetadata({
                prisma,
                videos,
              })
              if (
                values.size !== 192 ||
                [...values.values()].some(
                  (row) =>
                    row.muxThumbnailBlurDataUrl?.length !== 400 ||
                    row.muxThumbnailDominantColor !== "#123456" ||
                    row.muxHeroPosterBlurDataUrl?.length !== 400 ||
                    row.muxHeroPosterDominantColor !== "#123456",
                )
              ) {
                throw Error("batch output differs")
              }
            }
          })
          catalog.push(performance.now() - at)
          if (!burst) await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }),
    )
    worker.postMessage("stop")
    const externalLatencies = await external
    loop.disable()
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return {
        count: values.length,
        p50Ms: sorted[Math.floor(values.length * 0.5)],
        p95Ms: sorted[Math.floor(values.length * 0.95)],
        maxMs: Math.max(...values),
        over700Ms: values.filter((value) => value > 700).length,
      }
    }
    console.log(
      JSON.stringify({
        baseline,
        burst,
        elapsedMs: performance.now() - start,
        catalog: stats(catalog),
        transactions: stats(transactions),
        externalProbe: stats(externalLatencies),
        loopMaxMs: loop.max / 1e6,
      }),
    )
  } finally {
    await worker?.terminate()
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve())
      else resolve()
    })
    loop.disable()
    globalThis.fetch = originalFetch
    await base.$disconnect()
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await db.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
