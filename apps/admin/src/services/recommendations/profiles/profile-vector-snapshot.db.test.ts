import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migration = readFileSync(
  new URL(
    "../../../../prisma/migrations/0116_recommendation_profile_vector_snapshot/migration.sql",
    import.meta.url,
  ),
  "utf8",
)
const vector = `[${Array<number>(1536).fill(0.25).join(",")}]`

describe.skipIf(!RUN_REAL_DB_TEST)("profile vector snapshot migration", () => {
  const schema = `profile_vector_snapshot_${randomUUID().replaceAll("-", "")}`
  let client: Client
  let heapBeforeMigration: number
  let heapAfterMigration: number
  let migrationMs: number

  beforeAll(async () => {
    const databaseUrl = new URL(env.DATABASE_URL)
    if (
      !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
      databaseUrl.search !== "" ||
      databaseUrl.hash !== ""
    ) {
      throw new Error(
        "Profile vector snapshot fixture requires a plain local Postgres URL",
      )
    }
    client = new Client({ connectionString: env.DATABASE_URL })
    await client.connect()
    await client.query(
      `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`,
    )
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await client.query(`
      CREATE TABLE recommendation_profile_interest (
        id text PRIMARY KEY, generation_id text NOT NULL,
        kind text NOT NULL, interest_ordinal int NOT NULL,
        medoid_media_id text NOT NULL, medoid_source_digest char(64) NOT NULL,
        embedding public.vector(1536) NOT NULL, weight float8 NOT NULL,
        support_count int NOT NULL, stability float8 NOT NULL,
        expires_at timestamptz NOT NULL
      );
    `)
    await client.query(
      `INSERT INTO recommendation_profile_interest VALUES
       ('old', 'generation-old', 'durable', 0, 'content-1', $1,
        $2::public.vector(1536), 0.5, 2, 0.7, now() + interval '1 day')`,
      ["a".repeat(64), vector],
    )
    await client.query(
      `INSERT INTO recommendation_profile_interest
       SELECT 'legacy-' || n, 'generation-' || n, 'durable', 0,
         'content-1', $1, $2::public.vector(1536), 0.5, 2, 0.7,
         now() + interval '1 day'
       FROM generate_series(1, 2000) n`,
      ["a".repeat(64), vector],
    )
    heapBeforeMigration = Number(
      (
        await client.query<{ bytes: string }>(
          `SELECT pg_relation_size('recommendation_profile_interest')::text AS bytes`,
        )
      ).rows[0]?.bytes,
    )
    const started = performance.now()
    await client.query(migration)
    migrationMs = performance.now() - started
    heapAfterMigration = Number(
      (
        await client.query<{ bytes: string }>(
          `SELECT pg_relation_size('recommendation_profile_interest')::text AS bytes`,
        )
      ).rows[0]?.bytes,
    )
  })

  afterAll(async () => {
    if (!client) return
    await client.query(`DROP SCHEMA "${schema}" CASCADE`)
    await client.end()
  })

  it("reads inline and shared rows exactly and rejects invalid shapes", async () => {
    expect(heapAfterMigration).toBe(heapBeforeMigration)
    expect(migrationMs).toBeLessThan(10_000)
    await client.query(
      `INSERT INTO recommendation_profile_vector_snapshot (digest, embedding)
       VALUES (
         encode(sha256(convert_to(($1::public.vector(1536))::text, 'UTF8')), 'hex'),
         $1::public.vector(1536)
       )`,
      [vector],
    )
    await client.query(
      `INSERT INTO recommendation_profile_interest
       (id, generation_id, kind, interest_ordinal, medoid_media_id,
        medoid_source_digest, vector_digest, weight, support_count,
        stability, expires_at)
       SELECT 'new', 'generation-new', 'durable', 0, 'content-1',
         $1, digest, 0.3, 1, 0.8, now() + interval '1 day'
       FROM recommendation_profile_vector_snapshot`,
      ["a".repeat(64)],
    )
    const rows = await client.query<{ id: string; bytes: Buffer }>(`
      SELECT interest.id,
        public.vector_send(COALESCE(interest.embedding, snapshot.embedding)) AS bytes
      FROM recommendation_profile_interest interest
      LEFT JOIN recommendation_profile_vector_snapshot snapshot
        ON snapshot.digest = interest.vector_digest
      WHERE interest.id IN ('old', 'new')
      ORDER BY interest.id
    `)
    expect(rows.rows.map((row) => row.id)).toEqual(["new", "old"])
    expect(rows.rows[0]?.bytes.equals(rows.rows[1]!.bytes)).toBe(true)
    await expect(
      client.query(
        `INSERT INTO recommendation_profile_interest
         (id, generation_id, kind, interest_ordinal, medoid_media_id,
          medoid_source_digest, weight, support_count, stability, expires_at)
         VALUES ('invalid', 'g', 'durable', 0, 'm', $1, 0.3, 1, 0.8, now())`,
        ["a".repeat(64)],
      ),
    ).rejects.toThrow(/recommendation_profile_interest_vector_shape_check/)
  })

  it("retains referenced content, then removes the orphan after erasure", async () => {
    await expect(
      client.query(
        `UPDATE recommendation_profile_vector_snapshot SET created_at = now()`,
      ),
    ).rejects.toThrow(/immutable/)
    await expect(
      client.query(`DELETE FROM recommendation_profile_vector_snapshot`),
    ).rejects.toThrow(/foreign key constraint/)
    await client.query(
      `DELETE FROM recommendation_profile_interest WHERE id = 'old'`,
    )
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM recommendation_profile_vector_snapshot`,
        )
      ).rows[0]?.count,
    ).toBe(1)
    await client.query(
      `DELETE FROM recommendation_profile_interest WHERE id = 'new'`,
    )
    await client.query(`
      DELETE FROM recommendation_profile_vector_snapshot snapshot
      WHERE NOT EXISTS (
        SELECT 1 FROM recommendation_profile_interest interest
        WHERE interest.vector_digest = snapshot.digest
      )
    `)
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS count FROM recommendation_profile_vector_snapshot`,
        )
      ).rows[0]?.count,
    ).toBe(0)
  })

  it("serializes snapshot reuse with the orphan sweep", async () => {
    const sweeper = new Client({ connectionString: env.DATABASE_URL })
    await sweeper.connect()
    try {
      await sweeper.query(`SET search_path TO "${schema}", public`)
      await client.query("BEGIN")
      await client.query("SELECT pg_advisory_xact_lock_shared(368000002)")
      await sweeper.query("BEGIN")
      const locked = await sweeper.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(368000002) AS locked",
      )
      expect(locked.rows[0]?.locked).toBe(false)
      const shared = await sweeper.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock_shared(368000002) AS locked",
      )
      expect(shared.rows[0]?.locked).toBe(true)
      await client.query(
        `INSERT INTO recommendation_profile_vector_snapshot (digest, embedding)
         VALUES (
           encode(sha256(convert_to(($1::public.vector(1536))::text, 'UTF8')), 'hex'),
           $1::public.vector(1536)
         )`,
        [vector],
      )
      await client.query(
        `INSERT INTO recommendation_profile_interest
         (id, generation_id, kind, interest_ordinal, medoid_media_id,
          medoid_source_digest, vector_digest, weight, support_count,
          stability, expires_at)
         SELECT 'concurrent', 'generation-concurrent', 'durable', 0,
           'content-1', $1, digest, 0.3, 1, 0.8, now() + interval '1 day'
         FROM recommendation_profile_vector_snapshot`,
        ["a".repeat(64)],
      )
      await client.query("COMMIT")
      const acquired = await sweeper.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(368000002) AS locked",
      )
      expect(acquired.rows[0]?.locked).toBe(true)
      const removed = await sweeper.query(`
        DELETE FROM recommendation_profile_vector_snapshot snapshot
        WHERE NOT EXISTS (
          SELECT 1 FROM recommendation_profile_interest interest
          WHERE interest.vector_digest = snapshot.digest
        )
      `)
      expect(removed.rowCount).toBe(0)
      await sweeper.query("COMMIT")
    } finally {
      await client.query("ROLLBACK")
      await sweeper.query("ROLLBACK")
      await sweeper.end()
    }
  })
})
