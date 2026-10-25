/** Local-only reproduction: catalog hydration sharing a loop with small SQL transactions. */
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { Worker } from "node:worker_threads"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { env } from "@/config/env"
import { createLoaders } from "@/graphql/loaders"

type Sample = { ms: number; status: number }
type Measurements = { catalog: Sample[]; probe: Sample[] }

async function main() {
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(env.DATABASE_URL).hostname,
    )
  ) {
    throw new Error("This disposable fixture requires local PostgreSQL")
  }
  const baseline = process.argv.includes("--baseline")
  const schema = `duration_probe_${randomUUID().replaceAll("-", "")}`
  const admin = new Client({ connectionString: env.DATABASE_URL })
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: env.DATABASE_URL,
        max: 10,
        options: `-c search_path=${schema}`,
      },
      { schema },
    ),
  })
  const ids = Array.from({ length: 216 }, (_, i) => `v-${i + 1}`)
  const monitor = monitorEventLoopDelay({ resolution: 10 })
  let worker: Worker | undefined
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/catalog") {
        // Historical implementation, retained only for this explicit control run.
        const durations = baseline
          ? (
              await prisma.video.findMany({
                where: { id: { in: ids }, deletedAt: null },
                select: {
                  id: true,
                  primaryLanguageId: true,
                  dubs: {
                    where: {
                      published: true,
                      hls: { not: null },
                      deletedAt: null,
                      duration: { gt: 0 },
                    },
                    orderBy: [{ duration: "desc" }],
                    take: 5,
                    select: { languageId: true, duration: true },
                  },
                },
              })
            ).map(
              (video) =>
                (
                  video.dubs.find(
                    (dub) => dub.languageId === video.primaryLanguageId,
                  ) ?? video.dubs[0]
                )?.duration ?? null,
            )
          : await createLoaders(prisma).videoPrimaryDubDurationById.loadMany(
              ids,
            )
        if (
          durations.length !== ids.length ||
          durations.some((value) => value !== 999)
        )
          throw new Error("Duration parity failed")
      } else {
        // Deliberately a transaction probe, not a synthetic selection acknowledgment.
        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < 8; i++) await tx.$queryRaw`SELECT 1`
        })
      }
      response.end("ok")
    } catch {
      response.statusCode = 500
      response.end("failed")
    }
  })
  await admin.connect()
  try {
    await admin.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE video (id text PRIMARY KEY, primary_language_id text, deleted_at timestamp);
      CREATE TABLE video_dub (id text PRIMARY KEY, video_id text, language_id text,
        duration int, hls text, published boolean, deleted_at timestamp);
      CREATE INDEX ON video_dub(video_id);
      CREATE INDEX ON video_dub(video_id,duration DESC,id ASC)
        WHERE deleted_at IS NULL AND published=true AND hls IS NOT NULL;
      INSERT INTO video(id) SELECT 'v-' || n FROM generate_series(1,216) n;
      INSERT INTO video_dub SELECT v.id || '-' || n,v.id,'lang-' || n,1000-n,'stream',true,NULL
        FROM video v CROSS JOIN generate_series(1,662) n;
      ANALYZE video; ANALYZE video_dub;`)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("Probe server did not start")
    monitor.enable()
    const measurements = await new Promise<Measurements>((resolve, reject) => {
      worker = new Worker(
        `
        const {parentPort,workerData}=require('node:worker_threads');
        const {setTimeout:delay}=require('node:timers/promises');
        const start=Date.now(),metrics={catalog:[],probe:[]};
        async function run(path){
          const at=performance.now();let status=0;
          try{const r=await fetch(workerData.url+'/'+path,{signal:AbortSignal.timeout(10000)});await r.text();status=r.status}catch{}
          metrics[path].push({ms:performance.now()-at,status});
        }
        Promise.all([
          (async()=>{for(let i=0;i<12;i++){
            await delay(Math.max(0,start+i*2500-Date.now()));
            await Promise.all([run('catalog'),run('catalog')]);
          }})(),
          (async()=>{while(Date.now()-start<30000){await run('probe');await delay(100)}})()
        ]).then(()=>parentPort.postMessage(metrics));
      `,
        { eval: true, workerData: { url: `http://127.0.0.1:${address.port}` } },
      )
      worker.once("message", resolve)
      worker.once("error", reject)
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Probe worker exited ${code}`))
      })
    })
    const summarize = (samples: Sample[]) => {
      const times = samples.map((sample) => sample.ms).sort((a, b) => a - b)
      return {
        count: samples.length,
        httpFailures: samples.filter((sample) => sample.status !== 200).length,
        p95Ms: times[Math.floor(times.length * 0.95)],
        maxMs: times.at(-1),
        over700Ms: times.filter((ms) => ms > 700).length,
      }
    }
    const catalog = summarize(measurements.catalog)
    const probe = summarize(measurements.probe)
    console.log(
      JSON.stringify(
        {
          baseline,
          videos: ids.length,
          dubs: ids.length * 662,
          catalog,
          probe,
          eventLoopMaxMs: monitor.max / 1e6,
        },
        null,
        2,
      ),
    )
    if (
      catalog.httpFailures ||
      probe.httpFailures ||
      (!baseline && probe.over700Ms)
    )
      process.exitCode = 1
  } finally {
    monitor.disable()
    await worker?.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await prisma.$disconnect()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
