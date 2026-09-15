import { runMastraDatabaseMigrations } from "../scripts/migrate-mastra-database"
import { runDevotionalDatabaseMigrations } from "../scripts/migrate-devotional-database"
import { env } from "../config/env"
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { Pool } from "pg"
import { PostgresStore } from "@mastra/pg"
import { Agent } from "@mastra/core/agent"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import {
  captureCurrentChatMarkers,
  reconcileChatMarkers,
} from "./ai-chat-planned-restore"
import { Memory } from "@mastra/memory"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import {
  runAiChatDatabaseMigrations,
  CHAT_MIGRATIONS_DIRECTORY,
} from "../scripts/migrate-ai-chat-database"
import {
  deleteAiChatConversation,
  eraseAiChatConversation,
  expireAiChatConversation,
  runAiChatLifecycleTransaction,
} from "./ai-chat-conversation-lifecycle"
import { getAiChatGuardReadiness } from "./ai-chat-guard-readiness"
import { CHAT_MIGRATION } from "./ai-chat-guard-manifest"
import { runAiChatRetentionPurge } from "./ai-chat-retention"
import {
  buildPersistedErasureMemory,
  executeAiChatErasure,
  previewAiChatErasure,
} from "./ai-chat-erasure"

const url = process.env.CHAT_LIFECYCLE_TEST_DATABASE_URL
const enabled = process.env.CHAT_LIFECYCLE_PG_TEST === "1"
function barrier() {
  let release!: () => void, arrive!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    arrive = resolve
  })
  return { release, arrive, wait, reached }
}
const old = new Date("2020-01-01T00:00:00Z")
const owner = "user:synthetic"
function thread(id: string, resourceId = owner) {
  return {
    id,
    resourceId,
    title: "",
    createdAt: old,
    updatedAt: old,
    metadata: {},
  }
}
function message(id: string, threadId: string, resourceId = owner) {
  return {
    id,
    threadId,
    resourceId,
    role: "user" as const,
    createdAt: old,
    content: {
      format: 2 as const,
      parts: [{ type: "text" as const, text: "synthetic" }],
    },
  }
}

// This suite owns the entire explicitly named LOCAL disposable database.
// Separate env from other smokes; no production/staging or inherited DATABASE_URL.
describe.skipIf(!enabled)(
  "conversation lifecycle, pinned SDK and real PostgreSQL",
  () => {
    let pool: Pool, store: PostgresStore
    const options = () => ({ pool })
    async function blockedInsert(blocker: number, table: string) {
      return vi.waitFor(
        async () => {
          const rows = (
            await pool.query<{ pid: number }>(
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE $2",
              [blocker, `%INSERT INTO%${table}%`],
            )
          ).rows
          expect(rows).toHaveLength(1)
          return rows[0]!.pid
        },
        { interval: 10, timeout: 800 },
      )
    }
    async function migrate() {
      return runAiChatDatabaseMigrations({
        pool,
        initialize: () => store.init(),
      })
    }
    async function seed(id = "one", resourceId = owner) {
      const domain = await store.getStore("memory")
      await domain!.saveThread({ thread: thread(id, resourceId) })
      await domain!.saveMessages({
        messages: [message(`${id}-m`, id, resourceId)],
      })
      return domain!
    }
    async function counts(id: string) {
      return (
        await pool.query(
          `SELECT
      (SELECT count(*)::int FROM ai_chat.mastra_threads WHERE id=$1) AS threads,
      (SELECT count(*)::int FROM ai_chat.mastra_messages WHERE thread_id=$1) AS messages,
      (SELECT count(*)::int FROM ai_chat.forge_conversation_lifecycle WHERE id=$1 AND deleted) AS deleted`,
          [id],
        )
      ).rows[0]
    }
    beforeAll(async () => {
      if (!url) throw new Error("local lifecycle database URL required")
      const target = new URL(url)
      if (
        !["127.0.0.1", "localhost"].includes(target.hostname) ||
        !target.pathname.endsWith("_lifecycle_smoke") ||
        process.env.NODE_ENV === "production"
      )
        throw new Error("refusing non-disposable lifecycle target")
      pool = new Pool({
        connectionString: url,
        max: 5,
        connectionTimeoutMillis: 1000,
        statement_timeout: 5000,
      })
      pool.on("error", () => {})
      await pool.query(
        "DROP SCHEMA IF EXISTS devotional_workspace, support_research, datadog_triage CASCADE",
      )
    })
    beforeEach(async () => {
      vi.restoreAllMocks()
      await store?.close()
      await pool.query("DROP SCHEMA IF EXISTS ai_chat CASCADE")
      await pool.query("CREATE SCHEMA ai_chat")
      store = new PostgresStore({
        id: "lifecycle-smoke",
        connectionString: url!,
        schemaName: "ai_chat",
        max: 5,
        connectionTimeoutMillis: 1000,
        statement_timeout: 5000,
      })
      await store.init()
    })
    afterAll(async () => {
      await store?.close()
      await pool?.end()
    })

    it("deploys before migration, refreshes readiness, serializes reruns and preserves independent history", async () => {
      expect(await getAiChatGuardReadiness(pool)).toBe("not_applied")
      expect(await runAiChatRetentionPurge({ pool })).toEqual({
        kind: "not_ready",
        reason: "not_applied",
      })
      await expect(
        deleteAiChatConversation("absent", owner, options()),
      ).rejects.toMatchObject({ reason: "not_ready" })
      const results = await Promise.all([migrate(), migrate()])
      expect(results.flatMap((r) => r.applied)).toEqual([CHAT_MIGRATION.name])
      expect(results.flatMap((r) => r.skipped)).toEqual([CHAT_MIGRATION.name])
      expect(await getAiChatGuardReadiness(pool)).toBe("ready")
      await pool.query(
        "CREATE OR REPLACE TRIGGER forge_thread_insert BEFORE INSERT ON ai_chat.mastra_threads FOR EACH ROW WHEN (false) EXECUTE FUNCTION ai_chat.forge_guard_thread_insert()",
      )
      expect(await getAiChatGuardReadiness(pool)).toBe("incompatible")
      expect(await runAiChatRetentionPurge({ pool })).toEqual({
        kind: "failed",
        reason: "incompatible",
      })
      await expect(
        deleteAiChatConversation("conditional-guard", owner, options()),
      ).rejects.toMatchObject({ reason: "not_ready" })
      await pool.query(
        "CREATE OR REPLACE TRIGGER forge_thread_insert BEFORE INSERT ON ai_chat.mastra_threads FOR EACH ROW EXECUTE FUNCTION ai_chat.forge_guard_thread_insert()",
      )
      expect(await getAiChatGuardReadiness(pool)).toBe("ready")
      const restricted = await pool.connect()
      try {
        await restricted.query("CREATE ROLE feat247_readiness_test NOLOGIN")
        await restricted.query(
          "GRANT USAGE ON SCHEMA ai_chat TO feat247_readiness_test",
        )
        await restricted.query(
          "GRANT SELECT ON ai_chat.forge_schema_migrations TO feat247_readiness_test",
        )
        await restricted.query(
          "GRANT SELECT ON ai_chat.forge_conversation_lifecycle TO feat247_readiness_test",
        )
        await restricted.query(
          "GRANT SELECT,DELETE ON ai_chat.mastra_threads,ai_chat.mastra_messages TO feat247_readiness_test",
        )
        await restricted.query("SET ROLE feat247_readiness_test")
        expect(
          (
            await restricted.query(
              "SELECT has_table_privilege('ai_chat.forge_conversation_lifecycle','SELECT,INSERT,UPDATE,DELETE') AS any_privilege",
            )
          ).rows[0].any_privilege,
        ).toBe(true)
        expect(await getAiChatGuardReadiness(restricted)).toBe("incompatible")
        await expect(
          restricted.query("SELECT id FROM ai_chat.mastra_threads FOR UPDATE"),
        ).rejects.toMatchObject({ code: "42501" })
        await restricted.query("RESET ROLE")
        await restricted.query(
          "GRANT INSERT,UPDATE,DELETE ON ai_chat.forge_conversation_lifecycle,ai_chat.mastra_threads,ai_chat.mastra_messages TO feat247_readiness_test",
        )
        await restricted.query("SET ROLE feat247_readiness_test")
        expect(await getAiChatGuardReadiness(restricted)).toBe("ready")
        for (const table of [
          "forge_conversation_lifecycle",
          "mastra_threads",
          "mastra_messages",
        ])
          for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
            await restricted.query("RESET ROLE")
            await restricted.query(
              `REVOKE ${privilege} ON ai_chat.${table} FROM feat247_readiness_test`,
            )
            await restricted.query("SET ROLE feat247_readiness_test")
            expect(await getAiChatGuardReadiness(restricted)).toBe(
              "incompatible",
            )
            await restricted.query("RESET ROLE")
            await restricted.query(
              `GRANT ${privilege} ON ai_chat.${table} TO feat247_readiness_test`,
            )
          }
        await restricted.query(
          "REVOKE USAGE ON SCHEMA ai_chat FROM feat247_readiness_test",
        )
        await restricted.query("SET ROLE feat247_readiness_test")
        expect(await getAiChatGuardReadiness(restricted)).toBe("error")
        await restricted.query("RESET ROLE")
        await restricted.query(
          "GRANT USAGE ON SCHEMA ai_chat TO feat247_readiness_test",
        )
        for (const fn of [
          "thread_insert",
          "message_insert",
          "thread_identity",
          "message_identity",
        ]) {
          await restricted.query(
            `REVOKE EXECUTE ON FUNCTION ai_chat.forge_guard_${fn}() FROM PUBLIC`,
          )
          await restricted.query("SET ROLE feat247_readiness_test")
          expect(await getAiChatGuardReadiness(restricted)).toBe("incompatible")
          await restricted.query("RESET ROLE")
          await restricted.query(
            `GRANT EXECUTE ON FUNCTION ai_chat.forge_guard_${fn}() TO PUBLIC`,
          )
        }
        await restricted.query("SET ROLE feat247_readiness_test")
        expect(await getAiChatGuardReadiness(restricted)).toBe("ready")
      } finally {
        await restricted.query("RESET ROLE")
        await restricted.query("DROP OWNED BY feat247_readiness_test")
        await restricted.query("DROP ROLE feat247_readiness_test")
        restricted.release()
      }
      expect(
        (
          await pool.query(
            "SELECT to_regclass('devotional_workspace.schema_migrations') AS metadata",
          )
        ).rows[0].metadata,
      ).toBeNull()
      expect(
        createHash("sha256")
          .update(
            await readFile(
              `${CHAT_MIGRATIONS_DIRECTORY}/${CHAT_MIGRATION.name}`,
            ),
          )
          .digest("hex"),
      ).toBe(CHAT_MIGRATION.sha256)
      await pool.query(
        "UPDATE ai_chat.forge_schema_migrations SET sha256=repeat('0',64)",
      )
      expect(await getAiChatGuardReadiness(pool)).toBe("incompatible")
      await expect(migrate()).rejects.toThrow("checksum")
    })
    it("fails closed on pre-existing orphan/mismatched data, rolls back and permits repair/retry", async () => {
      await seed()
      await pool.query('UPDATE ai_chat.mastra_messages SET "resourceId"=$1', [
        "user:foreign",
      ])
      await expect(migrate()).rejects.toThrow(
        /chat_parent_integrity_failed count=1/,
      )
      expect(await getAiChatGuardReadiness(pool)).toBe("not_applied")
      await pool.query('UPDATE ai_chat.mastra_messages SET "resourceId"=$1', [
        owner,
      ])
      await pool.query("DELETE FROM ai_chat.mastra_threads")
      await expect(migrate()).rejects.toThrow(
        /chat_parent_integrity_failed count=1/,
      )
      await pool.query("DELETE FROM ai_chat.mastra_messages")
      await migrate()
      expect(await getAiChatGuardReadiness(pool)).toBe("ready")
    })
    it("reserves absent IDs before first creation and refuses real late creation/title/reply saves", async () => {
      await migrate()
      const domain = await store.getStore("memory")
      const hold = barrier()
      const late = (async () => {
        hold.arrive()
        await hold.wait
        return domain!.saveThread({ thread: thread("pending") })
      })()
      const refused = expect(late).rejects.toThrow()
      await hold.reached
      expect(await deleteAiChatConversation("pending", owner, options())).toBe(
        "deleted",
      )
      hold.release()
      await refused
      await expect(
        domain!.saveThread({
          thread: { ...thread("pending"), title: "late title" },
        }),
      ).rejects.toThrow()
      await expect(
        domain!.saveMessages({ messages: [message("late", "pending")] }),
      ).rejects.toThrow()
      expect(await counts("pending")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("waits for an uncommitted native INSERT then deletes the winning owner's content", async () => {
      await migrate()
      const writer = await pool.connect()
      await writer.query("BEGIN")
      const writerPid = (
        await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid
      await writer.query(
        'INSERT INTO ai_chat.mastra_threads (id,"resourceId",title,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())',
        ["pending", owner, ""],
      )
      const deleting = deleteAiChatConversation("pending", owner, options())
      void deleting.catch(() => undefined)
      try {
        await blockedInsert(writerPid, "forge_conversation_lifecycle")
      } finally {
        await writer.query("COMMIT")
        writer.release()
      }
      expect(await deleting).toBe("deleted")
      expect(await counts("pending")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("refuses saveMessages paused after its real existence read, without an orphan", async () => {
      await migrate()
      const domain = await seed()
      const hold = barrier(),
        original = domain.getThreadById.bind(domain)
      vi.spyOn(domain, "getThreadById").mockImplementation(async (args) => {
        const row = await original(args)
        hold.arrive()
        await hold.wait
        return row
      })
      const saving = domain.saveMessages({ messages: [message("late", "one")] })
      const refused = expect(saving).rejects.toThrow()
      await hold.reached
      await deleteAiChatConversation("one", owner, options())
      hold.release()
      await refused
      expect(await counts("one")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("supports concurrent retries and lost-success retry; competing owners cannot reassign", async () => {
      await migrate()
      await seed()
      expect(
        await Promise.all([
          deleteAiChatConversation("one", owner, options()),
          deleteAiChatConversation("one", owner, options()),
        ]),
      ).toEqual(["deleted", "deleted"])
      expect(await deleteAiChatConversation("one", owner, options())).toBe(
        "deleted",
      )
      expect(
        await deleteAiChatConversation("one", "user:foreign", options()),
      ).toBe("unavailable")
      const result = await Promise.all([
        deleteAiChatConversation("claim", owner, options()),
        deleteAiChatConversation("claim", "user:foreign", options()),
      ])
      expect(result.sort()).toEqual(["deleted", "unavailable"])
      expect(await counts("one")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("rolls back both content and protection on crash; stale snapshots cannot bypass guards", async () => {
      await migrate()
      await seed()
      await expect(
        runAiChatLifecycleTransaction(async (db) => {
          await db.query(
            "UPDATE ai_chat.forge_conversation_lifecycle SET deleted=true WHERE id=$1",
            ["one"],
          )
          await db.query(
            "DELETE FROM ai_chat.mastra_messages WHERE thread_id=$1",
            ["one"],
          )
          throw new Error("synthetic crash")
        }, options()),
      ).rejects.toMatchObject({ reason: "store_failed" })
      expect(await counts("one")).toEqual({
        threads: 1,
        messages: 1,
        deleted: 0,
      })
      const stale = await pool.connect()
      await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
      await stale.query("SELECT * FROM ai_chat.forge_conversation_lifecycle")
      await deleteAiChatConversation("one", owner, options())
      await expect(
        stale.query(
          'INSERT INTO ai_chat.mastra_threads (id,"resourceId",title,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())',
          ["one", owner, ""],
        ),
      ).rejects.toMatchObject({ code: "40001" })
      await stale.query("ROLLBACK")
      stale.release()
    })
    it("enforces immutable identities, parent cascade and atomic mixed-owner batches", async () => {
      await migrate()
      const domain = await seed()
      await seed("two")
      await seed("foreign", "user:foreign")
      // Both destination lifecycles are live, so the INSERT guards accept them.
      // The actual SDK conflict arm must still refuse moving the existing message.
      for (const [destination, resource] of [
        ["two", owner],
        ["foreign", "user:foreign"],
      ]) {
        await expect(
          domain.saveMessages({
            messages: [message("one-m", destination, resource)],
          }),
        ).rejects.toMatchObject({
          cause: { code: "P2470", message: "chat_identity_refused" },
        })
        expect(
          (
            await pool.query(
              'SELECT thread_id, "resourceId" FROM ai_chat.mastra_messages WHERE id=$1',
              ["one-m"],
            )
          ).rows[0],
        ).toMatchObject({ thread_id: "one", resourceId: owner })
      }
      for (const sql of [
        "UPDATE ai_chat.mastra_threads SET id='changed' WHERE id='one'",
        "UPDATE ai_chat.mastra_threads SET \"resourceId\"='foreign' WHERE id='one'",
        "UPDATE ai_chat.mastra_messages SET id='changed' WHERE id='one-m'",
        "UPDATE ai_chat.mastra_messages SET thread_id='two' WHERE id='one-m'",
        "UPDATE ai_chat.mastra_messages SET \"resourceId\"='foreign' WHERE id='one-m'",
      ])
        await expect(pool.query(sql)).rejects.toMatchObject({ code: "P2470" })
      await expect(
        domain.saveMessages({
          messages: [message("good", "one"), message("bad", "two", "foreign")],
        }),
      ).rejects.toThrow()
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM ai_chat.mastra_messages WHERE id IN ('good','bad')",
          )
        ).rows[0].n,
      ).toBe(0)
      await domain.deleteThread({ threadId: "one" })
      expect(await counts("one")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 0,
      })
      expect(await runAiChatRetentionPurge({ pool })).toMatchObject({
        recordsDeleted: 1,
      })
    })
    it("guards survive native reinitialization and uncovered storage refuses deletion", async () => {
      await migrate()
      await deleteAiChatConversation("one", owner, options())
      await store.close()
      store = new PostgresStore({
        id: "reinitialized",
        connectionString: url!,
        schemaName: "ai_chat",
        max: 2,
      })
      await store.init()
      expect(await getAiChatGuardReadiness(pool)).toBe("ready")
      await expect(
        (await store.getStore("memory"))!.saveThread({ thread: thread("one") }),
      ).rejects.toThrow()
      await expect(
        deleteAiChatConversation("other", owner, {
          pool,
          storageCovered: () => false,
        }),
      ).rejects.toMatchObject({ reason: "uncovered_storage" })
      await pool.query(
        "ALTER TABLE ai_chat.mastra_threads DISABLE TRIGGER forge_thread_insert",
      )
      expect(await getAiChatGuardReadiness(pool)).toBe("incompatible")
      await expect(
        deleteAiChatConversation("other", owner, options()),
      ).rejects.toMatchObject({ reason: "not_ready" })
    })
    it("retention removes expired content/live orphans, keeps markers and exact cutoff", async () => {
      await migrate()
      await seed("expired")
      await seed("boundary")
      await deleteAiChatConversation("deleted", owner, options())
      const cutoff = new Date("2026-01-01T00:00:00Z")
      await pool.query(
        'UPDATE ai_chat.mastra_threads SET "updatedAt"=$1::timestamptz AT TIME ZONE \'UTC\',"updatedAtZ"=$1::timestamptz WHERE id=$2',
        [cutoff, "boundary"],
      )
      await pool.query(
        'UPDATE ai_chat.mastra_threads SET "updatedAt"=$1::timestamptz AT TIME ZONE \'UTC\',"updatedAtZ"=$1::timestamptz WHERE id=$2',
        [old, "expired"],
      )
      expect(
        await expireAiChatConversation("boundary", cutoff, options()),
      ).toEqual({ threadsDeleted: 0, recordsDeleted: 0 })
      expect(
        await expireAiChatConversation("expired", cutoff, options()),
      ).toEqual({ threadsDeleted: 1, recordsDeleted: 1 })
      expect(
        await expireAiChatConversation("deleted", cutoff, options()),
      ).toEqual({ threadsDeleted: 0, recordsDeleted: 0 })
      expect(await counts("deleted")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("drains real retention pages past a refreshed candidate with one cutoff for every resource", async () => {
      await migrate()
      const at = Date.now()
      const cutoff = new Date(at - 25 * 86400000)
      await pool.query(
        `INSERT INTO ai_chat.mastra_threads (id,"resourceId",title,"createdAt","updatedAt","updatedAtZ")
        SELECT 'batch-' || lpad(n::text,4,'0'), CASE WHEN n%2=0 THEN 'user:batch' ELSE 'anon:batch' END, '', $1::timestamptz AT TIME ZONE 'UTC', $1::timestamptz AT TIME ZONE 'UTC', $1::timestamptz FROM generate_series(0,500) n`,
        [old],
      )
      await pool.query(
        'INSERT INTO ai_chat.mastra_threads (id,"resourceId",title,"createdAt","updatedAt","updatedAtZ") VALUES ($1,$2,$3,$4::timestamptz AT TIME ZONE \'UTC\',$4::timestamptz AT TIME ZONE \'UTC\',$4::timestamptz)',
        ["edge-boundary", owner, "", cutoff],
      )
      await deleteAiChatConversation("kept-deletion", owner, options())
      const domain = (await store.getStore("memory"))!
      const query = pool.query.bind(pool)
      let refreshed = false
      const spy = vi.spyOn(pool, "query").mockImplementation(((
        ...args: unknown[]
      ) => {
        const pending = Reflect.apply(query, pool, args)
        if (
          !refreshed &&
          typeof args[0] === "string" &&
          args[0].includes("SELECT l.id FROM")
        ) {
          refreshed = true
          return Promise.resolve(pending).then(async (rows) => {
            await domain.updateThread({
              id: "batch-0000",
              title: "refreshed",
              metadata: {},
            })
            return rows
          })
        }
        return pending
      }) as typeof pool.query)
      try {
        expect(await runAiChatRetentionPurge({ pool, now: () => at })).toEqual({
          kind: "complete",
          scanned: 501,
          deleted: 500,
          recordsDeleted: 500,
          sweeps: 2,
        })
      } finally {
        spy.mockRestore()
      }
      expect(refreshed).toBe(true)
      expect(
        (await pool.query("SELECT id FROM ai_chat.mastra_threads ORDER BY id"))
          .rows,
      ).toEqual([{ id: "batch-0000" }, { id: "edge-boundary" }])
      expect((await counts("kept-deletion")).deleted).toBe(1)
    }, 30000)
    it.each(["message", "thread"])(
      "preserves %s activity refreshed by real SDK before cleanup locks",
      async (kind) => {
        await migrate()
        const domain = await seed()
        await pool.query(
          'UPDATE ai_chat.mastra_threads SET "updatedAt"=$1::timestamptz AT TIME ZONE \'UTC\',"updatedAtZ"=$1::timestamptz',
          [old],
        )
        const hold = await pool.connect()
        await hold.query("BEGIN")
        await hold.query(
          "SELECT * FROM ai_chat.forge_conversation_lifecycle WHERE id=$1 FOR UPDATE",
          ["one"],
        )
        const expiring = expireAiChatConversation("one", new Date(), options())
        if (kind === "message")
          await domain.updateMessages({
            messages: [
              {
                id: "one-m",
                content: {
                  format: 2,
                  parts: [{ type: "text", text: "fresh" }],
                },
              },
            ],
          })
        else
          await domain.updateThread({ id: "one", title: "fresh", metadata: {} })
        await hold.query("COMMIT")
        hold.release()
        expect(await expiring).toEqual({ threadsDeleted: 0, recordsDeleted: 0 })
        expect((await counts("one")).threads).toBe(1)
      },
    )
    it("record-only erasure counts exact owners, is read-only in preview and demonstrates accepted recreation", async () => {
      await migrate()
      await deleteAiChatConversation("one", owner, options())
      await deleteAiChatConversation("adjacent", owner + "2", options())
      const memory = buildPersistedErasureMemory(
        new Memory({ storage: store }),
        pool,
      )
      const erasure = {
        resourceId: owner,
        acquireMemory: () => ({ ok: true as const, memory }),
        langfuse: {
          getConfig: () => ({
            timeoutMs: 1000,
            userAgent: "test",
            maxResponseBytes: 1000,
            promptCacheTtlMs: 1,
            promptFailureCooldownMs: 1,
          }),
        },
        log: { info: () => {}, warn: () => {} },
      }
      expect(await previewAiChatErasure(erasure)).toMatchObject({
        postgres: { kind: "counted", threadCount: 0, recordCount: 1 },
      })
      expect((await counts("one")).deleted).toBe(1)
      expect(await executeAiChatErasure(erasure)).toMatchObject({
        postgres: { kind: "erased", threadsDeleted: 0, recordsDeleted: 1 },
        langfuse: { kind: "skipped_unconfigured" },
      })
      expect((await counts("adjacent")).deleted).toBe(1)
      await (await store.getStore("memory"))!.saveThread({
        thread: thread("one"),
      })
      expect((await counts("one")).threads).toBe(1) // Accepted R13 exception, deliberately reproduced.
      await expect(
        eraseAiChatConversation("adjacent", owner, options()),
      ).rejects.toMatchObject({ reason: "owner_conflict" })
    })
    it("bounds a blocked target, permits unrelated IDs and releases pool slots", async () => {
      await migrate()
      await seed()
      const hold = await pool.connect()
      await hold.query("BEGIN")
      await hold.query(
        "SELECT * FROM ai_chat.forge_conversation_lifecycle WHERE id=$1 FOR UPDATE",
        ["one"],
      )
      const start = performance.now()
      const blocked = expect(
        deleteAiChatConversation("one", owner, { pool, budgetMs: 400 }),
      ).rejects.toMatchObject({ reason: "timeout" })
      expect(
        await deleteAiChatConversation("unrelated", owner, options()),
      ).toBe("deleted")
      const unrelatedMs = performance.now() - start
      await blocked
      const blockedMs = performance.now() - start
      await hold.query("ROLLBACK")
      hold.release()
      expect(blockedMs).toBeLessThan(1500)
      expect(unrelatedMs).toBeLessThan(400)
      console.info(
        JSON.stringify({
          measurement: "blocked_target",
          unrelatedMs,
          blockedMs,
          poolTotal: pool.totalCount,
          poolIdle: pool.idleCount,
          poolWaiting: pool.waitingCount,
        }),
      )
    })
    it("retries the whole absent reservation if maintenance removes its conflicting row", async () => {
      await migrate()
      await seed()
      const hold = barrier()
      const connect = pool.connect.bind(pool)
      let intercept = true
      const spy = vi.spyOn(pool, "connect").mockImplementation(async () => {
        const client = await connect()
        const query = client.query.bind(client)
        // The transaction helper uses the promise overload only. This test
        // intercepts a real protocol boundary without changing production code.
        client.query = ((...args: unknown[]) => {
          const sql = args[0]
          if (
            intercept &&
            typeof sql === "string" &&
            sql.startsWith('SELECT id, "resourceId", deleted')
          ) {
            intercept = false
            hold.arrive()
            return hold.wait.then(() => Reflect.apply(query, client, args))
          }
          return Reflect.apply(query, client, args)
        }) as typeof client.query
        return client
      })
      const deleting = deleteAiChatConversation("one", owner, options())
      await hold.reached
      await eraseAiChatConversation("one", owner, options())
      hold.release()
      expect(await deleting).toBe("deleted")
      spy.mockRestore()
      expect(await counts("one")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("reconciles exact current markers after restore, including erased markers and verified empty", async () => {
      await migrate()
      await deleteAiChatConversation("current", owner, options())
      const current = await captureCurrentChatMarkers(options())
      await eraseAiChatConversation("current", owner, options())
      await seed("current") // older backup contains content deleted since backup
      await deleteAiChatConversation("erased-since-backup", owner, options())
      expect(await reconcileChatMarkers(current, options())).toEqual({
        records: 1,
        threadsRemoved: 1,
      })
      expect(await counts("current")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
      expect((await counts("erased-since-backup")).deleted).toBe(0)
      await eraseAiChatConversation("current", owner, options())
      const empty = await captureCurrentChatMarkers(options())
      await deleteAiChatConversation("old-backup-marker", owner, options())
      await reconcileChatMarkers(empty, options())
      expect((await counts("old-backup-marker")).deleted).toBe(0)
    })
    it("refuses missing/incomplete recovery input and conflicts atomically", async () => {
      await migrate()
      await deleteAiChatConversation("current", owner, options())
      const current = await captureCurrentChatMarkers(options())
      for (const input of [
        undefined,
        {},
        { ...current, complete: false },
        { ...current, count: 2 },
        { ...current, records: [] },
      ]) {
        expect(() => reconcileChatMarkers(input, options())).toThrow()
      }
      await eraseAiChatConversation("current", owner, options())
      await seed("current", "user:foreign")
      await expect(
        reconcileChatMarkers(current, options()),
      ).rejects.toMatchObject({ reason: "owner_conflict" })
      expect((await counts("current")).threads).toBe(1)
      expect(
        (
          await pool.query(
            'SELECT "resourceId" FROM ai_chat.mastra_threads WHERE id=$1',
            ["current"],
          )
        ).rows[0].resourceId,
      ).toBe("user:foreign")
    })
    it("bounds exhausted connection acquisition and statements; loss of connection cannot report success", async () => {
      await migrate()
      const small = new Pool({ connectionString: url, max: 1 })
      const occupied = await small.connect()
      const start = performance.now()
      await expect(
        deleteAiChatConversation("queued", owner, {
          pool: small,
          budgetMs: 100,
        }),
      ).rejects.toMatchObject({ reason: "timeout" })
      expect(performance.now() - start).toBeLessThan(1000)
      occupied.release()
      await vi.waitFor(() => expect(small.idleCount).toBe(1))
      await small.end()
      const stalled = barrier()
      let lateWriteRefused = false
      const stalledStart = performance.now()
      const stalledResult = runAiChatLifecycleTransaction(
        async (db) => {
          await db.query(
            'INSERT INTO ai_chat.forge_conversation_lifecycle (id,"resourceId",deleted) VALUES ($1,$2,true)',
            ["stalled", owner],
          )
          stalled.arrive()
          await stalled.wait
          try {
            await db.query("SELECT 1")
          } catch {
            lateWriteRefused = true
          }
        },
        { pool, budgetMs: 100 },
      )
      const rejection = expect(stalledResult).rejects.toMatchObject({
        reason: "timeout",
      })
      await stalled.reached
      await rejection
      expect(performance.now() - stalledStart).toBeLessThan(1000)
      expect((await counts("stalled")).deleted).toBe(0)
      stalled.release()
      await vi.waitFor(() => expect(lateWriteRefused).toBe(true))
      await expect(
        runAiChatLifecycleTransaction(
          async (db) => {
            await db.query("SELECT pg_sleep(2)")
          },
          { pool, budgetMs: 100 },
        ),
      ).rejects.toMatchObject({ reason: "timeout" })
      await expect(
        runAiChatLifecycleTransaction(async (db) => {
          await db.query("SELECT pg_terminate_backend(pg_backend_pid())")
        }, options()),
      ).rejects.toMatchObject({ reason: "store_failed" })
      expect((await counts("queued")).deleted).toBe(0)
    })
    it("lets cleanup win before native UPDATE-only work; late updates cannot recreate", async () => {
      await migrate()
      const domain = await seed()
      const hold = barrier(),
        original = domain.getThreadById.bind(domain)
      vi.spyOn(domain, "getThreadById").mockImplementation(async (args) => {
        const row = await original(args)
        hold.arrive()
        await hold.wait
        return row
      })
      const updating = domain.updateThread({
        id: "one",
        title: "late",
        metadata: {},
      })
      const settled = updating.catch(() => undefined)
      await hold.reached
      await expireAiChatConversation(
        "one",
        new Date(Date.now() + 1000),
        options(),
      )
      hold.release()
      await settled
      await domain.updateMessages({
        messages: [
          {
            id: "one-m",
            content: { format: 2, parts: [{ type: "text", text: "late" }] },
          },
        ],
      })
      expect(await counts("one")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 0,
      })
    })
    it("measures guard storage growth and normal persistence/deletion costs", async () => {
      await migrate()
      const domain = (await store.getStore("memory"))!
      const start = performance.now()
      for (let i = 0; i < 30; i++)
        await domain.saveThread({ thread: thread("measure-" + i) })
      const createMs = performance.now() - start
      const deleteStart = performance.now()
      for (let i = 0; i < 30; i++)
        await deleteAiChatConversation("measure-" + i, owner, options())
      const deleteMs = performance.now() - deleteStart
      const sizes = (
        await pool.query(
          "SELECT pg_relation_size('ai_chat.forge_conversation_lifecycle')::int heap, pg_indexes_size('ai_chat.forge_conversation_lifecycle')::int indexes",
        )
      ).rows[0]
      console.info(
        JSON.stringify({
          measurement: "thirty_conversations",
          createMs,
          deleteMs,
          ...sizes,
          poolTotal: pool.totalCount,
          poolIdle: pool.idleCount,
          poolWaiting: pool.waitingCount,
        }),
      )
    })
    it("rejects the native background title upsert after successful deletion", async () => {
      await migrate()
      const titleHold = barrier(),
        persisted = barrier()
      const usage = {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      }
      const makeModel = (text: string, hold?: ReturnType<typeof barrier>) =>
        new MockLanguageModelV3({
          doGenerate: async () => {
            if (hold) {
              hold.arrive()
              await hold.wait
            }
            return {
              content: [{ type: "text", text }],
              finishReason: { unified: "stop", raw: "stop" },
              usage,
              warnings: [],
            }
          },
          doStream: async () => {
            if (hold) {
              hold.arrive()
              await hold.wait
            }
            return {
              stream: simulateReadableStream({
                initialDelayInMs: null,
                chunkDelayInMs: null,
                chunks: [
                  { type: "stream-start", warnings: [] },
                  { type: "text-start", id: "0" },
                  { type: "text-delta", id: "0", delta: text },
                  { type: "text-end", id: "0" },
                  {
                    type: "finish",
                    finishReason: { unified: "stop", raw: "stop" },
                    usage,
                  },
                ],
              }),
            }
          },
        })
      const memory = new Memory({
        storage: store,
        options: {
          generateTitle: { model: makeModel("late title", titleHold) },
        },
      })
      const domain = (await store.getStore("memory"))!
      const save = domain.saveThread.bind(domain)
      vi.spyOn(domain, "saveThread").mockImplementation(async (args) => {
        try {
          return await save(args)
        } finally {
          if (args.thread.title === "late title") persisted.arrive()
        }
      })
      // PR2 owns log sanitization. Suppress raw native errors locally, never upload.
      vi.spyOn(console, "error").mockImplementation(() => {})
      const agent = new Agent({
        id: "lifecycle-native-title",
        name: "Synthetic",
        instructions: "test",
        model: makeModel("reply"),
        memory,
      })
      const stream = await agent.stream("synthetic", {
        memory: { thread: "automatic", resource: owner },
      })
      await stream.getFullOutput()
      await titleHold.reached
      await deleteAiChatConversation("automatic", owner, options())
      titleHold.release()
      await persisted.reached
      expect(await counts("automatic")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("preserves actual legacy streams and does not share their advisory lock", async () => {
      const expectedMigrations = (
        await readdir(new URL("../../migrations/", import.meta.url))
      )
        .filter((filename) => filename.endsWith(".sql"))
        .sort()
      expect(expectedMigrations.length).toBeGreaterThan(0)
      const legacy = await runMastraDatabaseMigrations({ pool })
      expect([...legacy.applied].sort()).toEqual(expectedMigrations)
      expect(legacy.skipped).toEqual([])
      const history = (
        await pool.query(
          "SELECT * FROM devotional_workspace.schema_migrations ORDER BY version",
        )
      ).rows
      expect(history.map((row) => row.name).sort()).toEqual(expectedMigrations)
      const hold = await pool.connect()
      await hold.query("BEGIN")
      await hold.query(
        "SELECT pg_advisory_xact_lock(hashtext('forge_devotional_workspace_migrations'))",
      )
      await migrate()
      await hold.query("ROLLBACK")
      hold.release()
      expect(
        (
          await pool.query(
            "SELECT * FROM devotional_workspace.schema_migrations ORDER BY version",
          )
        ).rows,
      ).toEqual(history)
      const rerun = await runDevotionalDatabaseMigrations({ pool })
      expect(rerun.applied).toEqual([])
      expect([...rerun.skipped].sort()).toEqual(expectedMigrations)
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM ai_chat.forge_schema_migrations",
          )
        ).rows[0].n,
      ).toBe(1)
    })
    it("bounds migration table-lock waits and retries with no falsely applied history", async () => {
      const hold = await pool.connect()
      await hold.query("BEGIN")
      await hold.query(
        "LOCK TABLE ai_chat.mastra_messages IN ACCESS SHARE MODE",
      )
      const start = performance.now()
      await expect(migrate()).rejects.toMatchObject({ code: "55P03" })
      expect(performance.now() - start).toBeLessThan(3500)
      expect(await getAiChatGuardReadiness(pool)).toBe("not_applied")
      await hold.query("ROLLBACK")
      hold.release()
      await migrate()
      expect(await getAiChatGuardReadiness(pool)).toBe("ready")
    })
    it("lets real native first creation commit before the waiting deletion", async () => {
      await migrate()
      const hold = await pool.connect()
      await hold.query("BEGIN")
      await hold.query("SELECT pg_advisory_xact_lock(247001)")
      const holderPid = (
        await hold.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid
      await pool.query(`CREATE FUNCTION ai_chat.test_creation_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(247001); RETURN NEW; END $$;
      CREATE TRIGGER test_creation_barrier AFTER INSERT ON ai_chat.mastra_threads FOR EACH ROW EXECUTE FUNCTION ai_chat.test_creation_barrier()`)
      const domain = (await store.getStore("memory"))!
      const creating = domain.saveThread({ thread: thread("native-pending") })
      void creating.catch(() => undefined)
      let deleting: ReturnType<typeof deleteAiChatConversation> | undefined
      try {
        const writerPid = await blockedInsert(holderPid, "mastra_threads")
        deleting = deleteAiChatConversation("native-pending", owner, options())
        void deleting.catch(() => undefined)
        await blockedInsert(writerPid, "forge_conversation_lifecycle")
      } finally {
        await hold.query("COMMIT")
        hold.release()
      }
      await creating
      expect(await deleting).toBe("deleted")
      expect(await counts("native-pending")).toEqual({
        threads: 0,
        messages: 0,
        deleted: 1,
      })
    })
    it("pause control defers maintenance and erasure while explicit migration/readiness remain runnable", async () => {
      const prior = env.AI_CHAT_MAINTENANCE_PAUSED
      env.AI_CHAT_MAINTENANCE_PAUSED = "true"
      try {
        await migrate()
        expect(await getAiChatGuardReadiness(pool)).toBe("ready")
        expect(await runAiChatRetentionPurge({ pool })).toEqual({
          kind: "not_ready",
          reason: "paused",
        })
        const memory = buildPersistedErasureMemory(
          new Memory({ storage: store }),
          pool,
        )
        expect(await memory.readiness()).toBe("incompatible")
      } finally {
        env.AI_CHAT_MAINTENANCE_PAUSED = prior
      }
      expect((await runAiChatRetentionPurge({ pool })).kind).toBe("complete")
    })
    it("measures actual SQL round trips on explicit deletion", async () => {
      await migrate()
      await seed()
      const client = await pool.connect()
      const query = client.query.bind(client)
      let queries = 0
      const spy = vi.spyOn(client, "query").mockImplementation(((
        ...args: unknown[]
      ) => {
        queries++
        return Reflect.apply(query, client, args)
      }) as typeof client.query)
      client.release()
      await deleteAiChatConversation("one", owner, options())
      spy.mockRestore()
      expect(queries).toBeGreaterThan(10)
      console.info(
        JSON.stringify({ measurement: "delete_wire_queries", queries }),
      )
    })
  },
)
