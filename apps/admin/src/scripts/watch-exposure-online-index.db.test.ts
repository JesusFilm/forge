import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client, Pool } from "pg"
import { describe, expect, it } from "vitest"
import { runExposureIndexOperator } from "./watch-exposure-online-index"

const url = process.env.WATCH_EXPOSURE_ONLINE_OPERATOR_TEST_DATABASE_URL
const enabled = Boolean(url)
const revision = "a".repeat(40)

function fixtureUrl(): string {
  if (!url) throw new Error("Native fixture URL missing")
  const parsed = new URL(url)
  if (
    parsed.hostname !== "127.0.0.1" ||
    !parsed.pathname.startsWith("/forge_exposure_operator_native_") ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "Native operator test requires an exclusive loopback database",
    )
  return url
}

function windowId(n: number): string {
  const hex = createHash("md5").update(`window:${n}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function loadDuring(
  operation: () => Promise<unknown>,
  databaseUrl: string,
) {
  const pool = new Pool({ connectionString: databaseUrl, max: 12 })
  const stop = { value: false }
  const writes: number[] = []
  const reads: number[] = []
  const errors: string[] = []
  let serial = 0
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
  async function worker(kind: "write" | "read") {
    const client = await pool.connect()
    try {
      await client.query("SET statement_timeout = '1500ms'")
      while (!stop.value) {
        const start = performance.now()
        try {
          if (kind === "write") {
            const id = randomUUID()
            await client.query(
              `INSERT INTO watch_surface_exposure
               (id,event_id,window_id,surface,block,presentation,placement,
                policy_version,position,item_path,kind,visibility_capability,
                occurred_at,received_at,expires_at)
               VALUES ($1,$2,$3,'watch','grid','card','home','watch-exposure-v1',
                       0,$4,'rendered','unknown',now(),now(),now()+interval '29 days')`,
              [`load-${id}`, id, randomUUID(), `/watch/${"a".repeat(96)}`],
            )
            writes.push(performance.now() - start)
          } else {
            const n = (serial++ % 50_000) + 1
            const path = `/watch/${createHash("md5").update(`item:${n}`).digest("hex").repeat(3)}`
            const result = await client.query(
              `SELECT id FROM watch_surface_exposure
               WHERE window_id=$1 AND surface='watch' AND block='grid'
                 AND presentation='card' AND placement='home' AND position=$2
                 AND item_path=$3 AND kind='rendered'`,
              [windowId(n), n % 6, path],
            )
            if (result.rowCount !== 1)
              errors.push("hit path returned wrong row count")
            reads.push(performance.now() - start)
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "query error")
        }
        await sleep(10)
      }
    } finally {
      client.release()
    }
  }
  const running = [
    ...Array.from({ length: 8 }, () => worker("write")),
    ...Array.from({ length: 4 }, () => worker("read")),
  ]
  try {
    await sleep(250)
    await operation()
  } finally {
    stop.value = true
    await Promise.all(running)
    await pool.end()
  }
  expect(errors).toEqual([])
  expect(writes.length).toBeGreaterThan(0)
  expect(reads.length).toBeGreaterThan(0)
  expect(Math.max(...writes)).toBeLessThan(1_500)
  return {
    writes: writes.length,
    reads: reads.length,
    maxWriteMs: Math.max(...writes),
  }
}

describe.runIf(enabled)(
  "Watch exposure online operator on exclusive PostgreSQL",
  () => {
    it("fails closed on bad admission and invalid catalog, then builds and drops under hit-path load", async () => {
      const databaseUrl = fixtureUrl()
      const db = new Client({ connectionString: databaseUrl })
      await db.connect()
      const receipts = await mkdtemp(join(tmpdir(), "watch-exposure-operator-"))
      try {
        const exists = await db.query(
          "SELECT to_regclass('public.watch_surface_exposure') AS relation",
        )
        if (exists.rows[0]?.relation)
          throw new Error("Exclusive fixture database is not empty")
        await db.query(`CREATE TABLE watch_surface_exposure (
        id text PRIMARY KEY, event_id uuid NOT NULL UNIQUE, window_id uuid NOT NULL,
        surface varchar(40) NOT NULL, block varchar(40) NOT NULL,
        presentation varchar(40) NOT NULL, placement varchar(64) NOT NULL,
        policy_version varchar(40) NOT NULL, position integer NOT NULL,
        item_path varchar(512) NOT NULL, kind varchar(16) NOT NULL,
        visibility_capability varchar(32), duplicate_count integer NOT NULL DEFAULT 0,
        occurred_at timestamp(3) NOT NULL, received_at timestamp(3) NOT NULL DEFAULT now(),
        expires_at timestamp(3) NOT NULL,
        CONSTRAINT watch_surface_exposure_position_check CHECK (position >= 0 AND position < 100)
      )`)
        await db.query(`INSERT INTO watch_surface_exposure
        (id,event_id,window_id,surface,block,presentation,placement,policy_version,
         position,item_path,kind,visibility_capability,occurred_at,received_at,expires_at)
        SELECT 'e-'||w||'-'||k, md5('event:'||w||':'||k)::uuid,
          md5('window:'||w)::uuid,'watch','grid','card','home','watch-exposure-v1',
          w%6,'/watch/'||repeat(md5('item:'||w),3),
          (ARRAY['rendered','eligible','selected'])[k], 'unknown',
          now()-((w%29)::text||' days')::interval,
          now()-((w%29)::text||' days')::interval,
          now()+((29-w%29)::text||' days')::interval
        FROM generate_series(1,50000) w CROSS JOIN generate_series(1,3) k`)
        await db.query(`CREATE INDEX watch_surface_exposure_window_item_idx ON watch_surface_exposure
        (window_id,surface,block,presentation,placement,position,item_path,kind)`)
        await db.query("ANALYZE watch_surface_exposure")
        const inspection = await runExposureIndexOperator(
          { action: "inspect", execute: false },
          { databaseUrl, revision },
        )
        const admitted = {
          databaseUrl,
          revision,
        }
        const createArgs = {
          action: "create-narrow" as const,
          execute: true,
          expectedTargetHash: inspection.targetHash,
          expectedSourceHash: inspection.sourceHash,
          expectedRevision: revision,
        }
        await expect(
          runExposureIndexOperator(
            {
              ...createArgs,
              expectedTargetHash: "0".repeat(64),
              receiptPath: join(receipts, "wrong.json"),
            },
            admitted,
          ),
        ).rejects.toThrow(/does not match/)
        expect(
          (
            await db.query(
              "SELECT to_regclass('watch_surface_exposure_window_item_narrow_idx') AS relation",
            )
          ).rows[0]?.relation,
        ).toBeNull()

        await expect(
          runExposureIndexOperator(
            { ...createArgs, receiptPath: join(receipts, "timed-out.json") },
            { ...admitted, statementTimeoutMs: 1 },
          ),
        ).rejects.toThrow(/uncertain/)
        const timedCandidate = await db.query(`SELECT indisvalid FROM pg_index
        WHERE indexrelid=to_regclass('watch_surface_exposure_window_item_narrow_idx')`)
        if (timedCandidate.rows.length) {
          expect(timedCandidate.rows[0]?.indisvalid).toBe(false)
          // Explicit fixture cleanup after inspecting the failed attempt.
          await db.query(
            "DROP INDEX CONCURRENTLY watch_surface_exposure_window_item_narrow_idx",
          )
        }

        const faultClient = new Client({ connectionString: databaseUrl })
        const originalQuery = faultClient.query.bind(faultClient)
        const faultQueries: string[] = []
        faultClient.query = ((...queryArgs: Parameters<Client["query"]>) => {
          const sql = String(queryArgs[0])
          faultQueries.push(sql)
          if (sql.startsWith("CREATE INDEX CONCURRENTLY"))
            return Promise.reject(
              Object.assign(new Error("socket closed"), {
                code: "ECONNRESET",
              }),
            )
          return originalQuery(...queryArgs)
        }) as Client["query"]
        await expect(
          runExposureIndexOperator(
            { ...createArgs, receiptPath: join(receipts, "transport.json") },
            { ...admitted, clientFactory: () => faultClient },
          ),
        ).rejects.toThrow(/outcome uncertain \(ECONNRESET\)/)
        expect(faultQueries.some((sql) => sql.startsWith("DROP INDEX"))).toBe(
          false,
        )
        expect(
          (
            await db.query(
              "SELECT to_regclass('watch_surface_exposure_window_item_narrow_idx') AS relation",
            )
          ).rows[0]?.relation,
        ).toBeNull()

        // A duplicate-producing concurrent UNIQUE build leaves the fixed candidate name invalid.
        await expect(
          db.query(`CREATE UNIQUE INDEX CONCURRENTLY watch_surface_exposure_window_item_narrow_idx
        ON watch_surface_exposure (surface)`),
        ).rejects.toThrow()
        const invalid =
          await db.query(`SELECT indisvalid,indisready FROM pg_index
        WHERE indexrelid='watch_surface_exposure_window_item_narrow_idx'::regclass`)
        expect(invalid.rows[0]?.indisvalid).toBe(false)
        await expect(
          runExposureIndexOperator(
            { ...createArgs, receiptPath: join(receipts, "invalid.json") },
            admitted,
          ),
        ).rejects.toThrow(/already exists/)
        expect(
          (
            await db.query(
              "SELECT to_regclass('watch_surface_exposure_window_item_narrow_idx') AS relation",
            )
          ).rows[0]?.relation,
        ).not.toBeNull()
        // Explicit local fixture cleanup after inspecting the invalid index; the operator never does this.
        await db.query(
          "DROP INDEX CONCURRENTLY watch_surface_exposure_window_item_narrow_idx",
        )

        const buildLoad = await loadDuring(
          () =>
            runExposureIndexOperator(
              { ...createArgs, receiptPath: join(receipts, "create.json") },
              admitted,
            ),
          databaseUrl,
        )
        expect(buildLoad.reads).toBeGreaterThan(0)
        const created = await runExposureIndexOperator(
          { action: "inspect", execute: false },
          admitted,
        )
        const candidate = created.before.indexes.find(
          (index) =>
            index.name === "watch_surface_exposure_window_item_narrow_idx",
        )
        expect(candidate).toMatchObject({
          valid: true,
          ready: true,
          live: true,
          keyCount: 6,
        })
        const dropLoad = await loadDuring(
          () =>
            runExposureIndexOperator(
              {
                action: "drop-wide",
                execute: true,
                expectedTargetHash: inspection.targetHash,
                expectedSourceHash: inspection.sourceHash,
                expectedRevision: revision,
                receiptPath: join(receipts, "drop.json"),
              },
              admitted,
            ),
          databaseUrl,
        )
        expect(dropLoad.reads).toBeGreaterThan(0)
        const final = await runExposureIndexOperator(
          { action: "inspect", execute: false },
          admitted,
        )
        expect(final.before.indexes.map((index) => index.name)).toEqual([
          "watch_surface_exposure_window_item_narrow_idx",
        ])
        const counts =
          await db.query(`SELECT count(*)::int AS rows,count(DISTINCT event_id)::int AS event_ids,
        count(*) FILTER (WHERE expires_at-occurred_at<>interval '29 days')::int AS bad_expiry
        FROM watch_surface_exposure`)
        expect(counts.rows[0]?.rows).toBe(counts.rows[0]?.event_ids)
        expect(counts.rows[0]?.bad_expiry).toBe(0)
        const receiptPath =
          process.env.WATCH_EXPOSURE_ONLINE_OPERATOR_TEST_RECEIPT
        if (receiptPath)
          await writeFile(
            receiptPath,
            JSON.stringify(
              {
                initialRows: 150_000,
                buildLoad,
                dropLoad,
                finalRows: counts.rows[0]?.rows,
                finalDistinctEventIds: counts.rows[0]?.event_ids,
                badExpiryRows: counts.rows[0]?.bad_expiry,
                candidateBytes: candidate?.bytes,
                finalCandidateBytes: final.before.indexes[0]?.bytes,
              },
              null,
              2,
            ) + "\n",
          )
      } finally {
        await db.end()
      }
    }, 120_000)
  },
)
