import { execFile } from "node:child_process"
import { cp, mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { Client } from "pg"
import { describe, expect, it } from "vitest"

import { env } from "../config/env"

const fixture = env.WATCH_EXPOSURE_RECONCILIATION_TEST_DATABASE_URL
const migration = "0121_watch_exposure_narrow_index_reconciliation"
const wide = "watch_surface_exposure_window_item_idx"
const narrow = "watch_surface_exposure_window_item_narrow_idx"
const columns = "window_id,surface,block,presentation,placement,position"
const run = promisify(execFile)

function fixtureUrl(suffix = "") {
  if (!fixture) throw new Error("Explicit native fixture required")
  const url = new URL(fixture)
  if (
    url.hostname !== "127.0.0.1" ||
    !url.pathname.startsWith("/forge_exposure_reconcile_") ||
    url.search ||
    url.hash
  )
    throw new Error("Exclusive loopback exposure fixture required")
  url.pathname += suffix
  return url.toString()
}

async function deploy(
  databaseUrl: string,
  schema = resolve("prisma/schema.prisma"),
) {
  await run(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", schema],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  )
}

async function emptyDatabase(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  const result = await client.query(
    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
  )
  if (result.rows[0]?.n !== 0) {
    await client.end()
    throw new Error(
      "Native fixture must start empty; never reset an existing database",
    )
  }
  return client
}

describe.runIf(Boolean(fixture))(
  "Watch exposure forward reconciliation",
  () => {
    it("deploys the complete Prisma history from zero", async () => {
      const databaseUrl = fixtureUrl()
      const client = await emptyDatabase(databaseUrl)
      try {
        await deploy(databaseUrl)
        const state = await client.query(`SELECT
          to_regclass('public.${wide}') AS old,
          to_regclass('public.${narrow}') AS candidate,
          pg_get_indexdef(i.indexrelid) AS definition,
          i.indisvalid AS valid,
          i.indisready AS ready,
          i.indislive AS live,
          i.indisunique AS unique,
          i.indisprimary AS primary,
          i.indisexclusion AS exclusion,
          i.indnkeyatts AS key_count,
          i.indnatts AS attribute_count,
          i.indpred IS NULL AS no_predicate,
          i.indexprs IS NULL AS no_expressions,
          am.amname AS access_method,
          c.relkind AS relation_kind
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_am am ON am.oid = c.relam
        WHERE i.indexrelid = 'public.${narrow}'::regclass`)
        expect(state.rows[0]).toEqual({
          old: null,
          candidate: narrow,
          definition: `CREATE INDEX ${narrow} ON public.watch_surface_exposure USING btree (window_id, surface, block, presentation, placement, "position")`,
          valid: true,
          ready: true,
          live: true,
          unique: false,
          primary: false,
          exclusion: false,
          key_count: 6,
          attribute_count: 6,
          no_predicate: true,
          no_expressions: true,
          access_method: "btree",
          relation_kind: "i",
        })
        const ledger = await client.query(
          "SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
          [migration],
        )
        expect(ledger.rows[0]?.n).toBe(1)
      } finally {
        await client.end()
      }
    }, 150_000)

    it("reconciles a populated online replacement without rewriting rows or blocking a writer; refuses partial states", async () => {
      const databaseUrl = fixtureUrl("_online")
      const client = await emptyDatabase(databaseUrl)
      const writer = new Client({ connectionString: databaseUrl })
      await writer.connect()
      const sql = await readFile(
        resolve(`prisma/migrations/${migration}/migration.sql`),
        "utf8",
      )
      try {
        // Exercise real migrate deploy for the historical checkpoint, then the
        // already-online populated state. No applied migration history is edited.
        const checkpoint = await mkdtemp(
          join(tmpdir(), "exposure-migration-checkpoint-"),
        )
        await cp(
          resolve("prisma/schema.prisma"),
          join(checkpoint, "schema.prisma"),
        )
        for (const name of await readdir(resolve("prisma/migrations"))) {
          if (name !== migration)
            await cp(
              resolve("prisma/migrations", name),
              join(checkpoint, "migrations", name),
              {
                recursive: true,
              },
            )
        }
        await deploy(databaseUrl, join(checkpoint, "schema.prisma"))
        await client.query(`INSERT INTO watch_surface_exposure
        (id,event_id,window_id,surface,block,presentation,placement,policy_version,
         position,item_path,kind,occurred_at,received_at,expires_at)
        SELECT 'fixture-'||n,md5('event-'||n)::uuid,md5('window')::uuid,
         'watch','grid','card','home','watch-exposure-v1',n,'/watch/fixture','rendered',
         timestamp '2026-09-01',timestamp '2026-09-01',timestamp '2026-09-30'
        FROM generate_series(1,3) n`)
        const rows = async () =>
          (
            await client.query(
              "SELECT * FROM watch_surface_exposure ORDER BY id",
            )
          ).rows
        const original = await rows()
        const rejected = async (pattern: RegExp) => {
          await expect(client.query(sql)).rejects.toThrow(pattern)
          await client.query("ROLLBACK")
          expect(await rows()).toEqual(original)
        }
        await rejected(/Populated exposure table/)
        await client.query(
          `CREATE INDEX CONCURRENTLY ${narrow} ON watch_surface_exposure (${columns})`,
        )
        await rejected(/Partial exposure index state/)
        await client.query(`DROP INDEX CONCURRENTLY ${wide}`)
        const before = (
          await client.query(`SELECT relfilenode,pg_relation_size(oid)::text AS bytes
        FROM pg_class WHERE oid='public.${narrow}'::regclass`)
        ).rows[0]
        await deploy(databaseUrl)
        const after = (
          await client.query(`SELECT relfilenode,pg_relation_size(oid)::text AS bytes
        FROM pg_class WHERE oid='public.${narrow}'::regclass`)
        ).rows[0]
        expect(after).toEqual(before)
        expect(await rows()).toEqual(original)
        await writer.query(
          "BEGIN; LOCK TABLE watch_surface_exposure IN ROW EXCLUSIVE MODE",
        )
        await client.query(sql)
        await writer.query("ROLLBACK")

        await writer.query(
          "BEGIN; LOCK TABLE watch_surface_exposure IN SHARE UPDATE EXCLUSIVE MODE",
        )
        const started = performance.now()
        await expect(client.query(sql)).rejects.toMatchObject({ code: "55P03" })
        expect(performance.now() - started).toBeLessThan(1_500)
        await client.query("ROLLBACK")
        await writer.query("ROLLBACK")
        expect(await rows()).toEqual(original)

        await client.query(`DROP INDEX ${narrow}`)
        await rejected(/Partial exposure index state/)
        await client.query(
          `CREATE INDEX ${narrow} ON watch_surface_exposure (${columns}) INCLUDE (item_path)`,
        )
        await rejected(/Unexpected narrow exposure index/)
        await client.query(`DROP INDEX ${narrow}`)
        await client.query(
          `CREATE INDEX ${narrow} ON watch_surface_exposure (${columns}) WHERE kind='rendered'`,
        )
        await rejected(/Unexpected narrow exposure index/)
        await client.query(`DROP INDEX ${narrow}`)
        // A failed concurrent unique build naturally leaves an invalid candidate.
        await expect(
          client.query(
            `CREATE UNIQUE INDEX CONCURRENTLY ${narrow} ON watch_surface_exposure (surface)`,
          ),
        ).rejects.toThrow()
        await rejected(/Unexpected narrow exposure index/)
        await client.query(`DROP INDEX ${narrow}`)
        await client.query(
          `CREATE INDEX ${narrow} ON watch_surface_exposure (${columns})`,
        )
        await client.query(sql)
        expect(await rows()).toEqual(original)
      } finally {
        await writer.query("ROLLBACK").catch(() => undefined)
        await client.query("ROLLBACK").catch(() => undefined)
        await Promise.all([client.end(), writer.end()])
      }
    }, 180_000)
  },
)
