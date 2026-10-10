import { env } from "@/config/env"
import { PrismaClient, Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { Worker } from "node:worker_threads"
import { graphql } from "graphql"
import { schema as gqlSchema } from "@/graphql/schema"
import { stripEmbeddingFromResult } from "@/db/client"

type Sample = { ms: number; status: number }
type CatalogDub = {
  id: string
  language: {
    coreId: string
    bcp47: string | null
    slug: string | null
    name: unknown
  }
  videoEdition: {
    subtitles: Array<{
      vttSrc: string | null
      primary: boolean
      language: { bcp47: string | null; slug: string | null }
    }>
  }
}

/** Local-only control/treatment for the observed 100-dub, 3,660-subtitle batch. */
async function main() {
  const url = env.DATABASE_URL
  if (new URL(url).hostname !== "127.0.0.1") throw Error("local only")
  const narrow = !process.argv.includes("--baseline")
  const schema = "catalog_" + randomUUID().replaceAll("-", "")
  const db = new Client({ connectionString: url })
  await db.connect()
  const p = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url, options: `-c search_path=${schema}`, max: 10 },
      { schema },
    ),
  })
  const stamp = new Date("2026-09-01T00:00:00Z")
  function enumValue(type: string) {
    const value = Prisma.dmmf.datamodel.enums.find((e) => e.name === type)!
      .values[0]!
    return value.dbName ?? value.name
  }
  function base(name: string, id: string) {
    const m = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!
    return Object.fromEntries(
      m.fields
        .filter((f) => f.kind !== "object")
        .map((f) => [
          f.name,
          f.name === "id" || f.name === "coreId"
            ? id
            : f.name === "deletedAt"
              ? null
              : f.type === "DateTime"
                ? stamp
                : f.type === "Boolean"
                  ? false
                  : f.type === "Int"
                    ? 120
                    : f.type === "BigInt"
                      ? 120000n
                      : f.type === "Json"
                        ? { en: "English", es: "Ingles", de: "Englisch" }
                        : f.kind === "enum"
                          ? enumValue(f.type)
                          : `${f.name}-${id}`,
        ]),
    )
  }
  let server: ReturnType<typeof createServer> | undefined
  let worker: Worker | undefined
  const loop = monitorEventLoopDelay({ resolution: 10 })
  try {
    await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`)
    for (const e of Prisma.dmmf.datamodel.enums) {
      await db.query(
        `CREATE TYPE "${e.dbName ?? e.name}" AS ENUM (${e.values.map((v) => `'${v.dbName ?? v.name}'`).join(",")})`,
      )
    }
    const models = [
      "VideoDub",
      "VideoEdition",
      "VideoSubtitle",
      "Language",
      "MuxVideo",
    ]
    for (const name of models) {
      const m = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!
      const columns = m.fields
        .filter((f) => f.kind !== "object")
        .map(
          (f) =>
            `"${f.dbName ?? f.name}" ${f.type === "Int" ? "int" : f.type === "BigInt" ? "bigint" : f.type === "Float" ? "float8" : f.type === "Boolean" ? "boolean" : f.type === "DateTime" ? "timestamp" : f.type === "Json" ? "jsonb" : "text"}${f.isId ? " PRIMARY KEY" : ""}`,
        )
      await db.query(`CREATE TABLE "${m.dbName}" (${columns.join(",")})`)
    }

    async function seed(
      name: string,
      count: number,
      extra: (i: number) => Record<string, unknown>,
    ) {
      const m = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!
      const rows = Array.from({ length: count }, (_, i) => {
        const data = { ...base(name, name + "-" + i), ...extra(i) }
        return Object.fromEntries(
          m.fields
            .filter((f) => f.kind !== "object")
            .map((f) => [f.dbName ?? f.name, data[f.name]]),
        )
      })
      const json = JSON.stringify(rows, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      )
      await db.query(
        `INSERT INTO "${m.dbName}" SELECT * FROM jsonb_populate_recordset(NULL::"${m.dbName}",$1::jsonb)`,
        [json],
      )
    }
    await seed("Language", 61, (i) => ({
      id: "l" + i,
      slug: "l" + i,
      bcp47: "l" + i,
    }))
    await seed("VideoEdition", 100, (i) => ({ id: "e" + i }))
    await seed("MuxVideo", 100, (i) => ({ id: "m" + i }))
    await seed("VideoDub", 100, (i) => ({
      id: "d" + i,
      videoEditionId: "e" + i,
      languageId: "l0",
      muxVideoId: "m" + i,
    }))
    await seed("VideoSubtitle", 3660, (i) => ({
      videoEditionId: "e" + Math.floor(i / 61),
      languageId: "l" + (i % 61),
      vttSrc:
        "https://media.example.test/" +
        "subtitle-url-path-".repeat(4) +
        i +
        ".vtt",
      srtSrc:
        "https://media.example.test/" +
        "subtitle-url-path-".repeat(4) +
        i +
        ".srt",
    }))
    await db.query(
      "CREATE INDEX ON video_subtitle(video_edition_id); ANALYZE video_subtitle",
    )
    const include = {
      language: true,
      muxVideo: true,
      videoEdition: {
        include: {
          subtitles: {
            where: { deletedAt: null },
            include: { language: true },
          },
        },
      },
    }
    let selection: Prisma.VideoDubFindManyArgs = {}
    const selectionResult = await graphql({
      schema: gqlSchema,
      source:
        '{videoDub(id:"probe"){id language{coreId bcp47 slug name} muxVideo{playbackId} videoEdition{subtitles{vttSrc primary language{bcp47 slug}}}}}',
      contextValue: {
        user: null,
        services: {
          video: {
            getDubById: ({ query }: { query: Prisma.VideoDubFindManyArgs }) => {
              selection = query
              return null
            },
          },
        },
      },
    })
    if (selectionResult.errors) throw selectionResult.errors[0]

    const normalize = (d: CatalogDub[]) =>
      d.map((r) => ({
        id: r.id,
        language: {
          coreId: r.language.coreId,
          bcp47: r.language.bcp47,
          slug: r.language.slug,
          name: r.language.name,
        },
        videoEdition: {
          subtitles: r.videoEdition.subtitles.map((s) => ({
            vttSrc: s.vttSrc,
            primary: s.primary,
            language: { bcp47: s.language.bcp47, slug: s.language.slug },
          })),
        },
      }))
    const expected = JSON.stringify(
      normalize(
        (await p.videoDub.findMany({ include })) as unknown as CatalogDub[],
      ),
    )
    let bytes = 0
    let calls = 0
    server = createServer(async (req, res) => {
      try {
        if (req.url === "/catalog") {
          const rows = stripEmbeddingFromResult(
            await p.videoDub.findMany(narrow ? selection : { include }),
          ) as unknown as CatalogDub[]
          const output = JSON.stringify(normalize(rows))
          if (output !== expected) throw Error("parity")
          bytes = output.length
          calls++
        } else {
          await p.$transaction(async (tx) => {
            for (let i = 0; i < 8; i++) await tx.$queryRaw`SELECT 1`
          })
        }
        res.end("ok")
      } catch (e) {
        console.error(e)
        res.statusCode = 500
        res.end("error")
      }
    })
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
    const address = server.address()
    if (!address || typeof address === "string")
      throw Error("Listener unavailable")
    loop.enable()
    const result = await new Promise<{ catalog: Sample[]; probe: Sample[] }>(
      (resolve, reject) => {
        worker = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');const {setTimeout:delay}=require('node:timers/promises');const start=Date.now(),r={catalog:[],probe:[]};async function run(path){const s=performance.now();let status=0;try{const q=await fetch(workerData.url+'/'+path,{signal:AbortSignal.timeout(10000)});await q.text();status=q.status}catch{}r[path].push({ms:performance.now()-s,status})}Promise.all([(async()=>{for(let i=0;i<12;i++){await delay(Math.max(0,start+i*2500-Date.now()));await Promise.all([run('catalog'),run('catalog')])}})(),(async()=>{while(Date.now()-start<30000){await run('probe');await delay(100)}})()]).then(()=>parentPort.postMessage(r))`,
          {
            eval: true,
            workerData: { url: "http://127.0.0.1:" + address.port },
          },
        )
        worker.once("message", resolve)
        worker.once("error", reject)
        worker.once("exit", (code) => {
          if (code !== 0) reject(new Error(`Probe worker exited ${code}`))
        })
      },
    )
    loop.disable()
    const summary = (a: Sample[]) => {
      const t = a.map((x) => x.ms).sort((a, b) => a - b)
      return {
        count: t.length,
        p95: t[Math.floor(t.length * 0.95)],
        max: t.at(-1),
        over700: t.filter((n) => n > 700).length,
        httpFailures: a.filter((x) => x.status !== 200).length,
      }
    }
    const catalog = summary(result.catalog)
    const probe = summary(result.probe)
    if (
      catalog.httpFailures ||
      probe.httpFailures ||
      (narrow && probe.over700 > 0)
    )
      process.exitCode = 1
    console.log(
      JSON.stringify(
        {
          narrow,
          bytes,
          calls,
          loopMax: loop.max / 1e6,
          catalog,
          probe,
        },
        null,
        2,
      ),
    )
  } finally {
    loop.disable()
    await worker?.terminate()
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()))
    await p.$disconnect()
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await db.end()
  }
}
void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
