import { randomUUID } from "node:crypto"

import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { AI_CHAT_SCHEMA_NAME } from "./ai-chat-memory"
import { assertThrowawayDatabaseTarget } from "./ai-chat-smoke-target-guard"
import { AI_CHAT_TITLE_MAX_UNITS } from "./ai-chat-title-clamp"
import {
  AI_CHAT_RENAME_POOL_OPTIONS,
  handleAiChatHistoryRenameRequest,
  type AiChatRenamePool,
} from "./ai-chat-history-write-route"

/**
 * Opt-in REAL-POSTGRES rename round trip (plan Verification Contract row
 * "Real-database round trip (AE1, AE3)"). Proves against a live store what
 * the mocked suites structurally cannot:
 *
 *   - AE1: after a rename EVERY column of the thread row other than `title`
 *     is byte-identical — `updatedAt` and `updatedAtZ` included — so the row
 *     keeps its rail position and its retention clock. The mocked SQL-shape
 *     test only proves the SET clause's text; this proves the database agreed
 *     (no default, no trigger, no driver-side timestamp touched the row).
 *   - The real-DB half of the timestamp-trigger pin: `ai_chat.mastra_threads`
 *     carries NO user trigger after `PostgresStore` ran its DDL. The dist-pin
 *     test reads the installer's source; this reads `pg_trigger`.
 *   - AE3: a 130-unit 3-byte-script title is stored AND echoed as the
 *     120-unit clamp.
 *   - AE4 on a real store: a foreign owner's rename is refused and leaves
 *     the row untouched; a missing thread is 404.
 *
 * Scope split, stated plainly: the handler runs with test-owned `getMemory`
 * / `getPool` seams over the SAME `DATABASE_URL`, so the suite can release
 * its own pool on teardown. The production default wiring (persisted-store
 * Memory, lazy pool on `getMastraDatabaseUrl`) is pinned by
 * `ai-chat-history-write-route.defaults.test.ts`; this suite proves the SQL
 * contract the defaults execute.
 *
 * DELIBERATELY OUT OF CI, and skipped (not failed) by default: it needs a
 * provisioned Postgres and it WRITES rows. Only the literal
 * `AI_CHAT_RENAME_SMOKE_TEST=1` enables it (read straight from `process.env`
 * — a test-only switch, deliberately not a schema env var: the plan adds no
 * env vars), mirroring `AI_CHAT_ERASURE_SMOKE_TEST`.
 *
 * ── Run it (against a THROWAWAY database — never production) ────────────────
 *
 *   AI_CHAT_RENAME_SMOKE_TEST=1 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forge_rename_smoke \
 *   pnpm --filter @forge/mastra test -- ai-chat-history-write-route.smoke
 *
 * `PostgresStore` runs its own DDL at init, so an empty database is enough.
 */

const RUN_SMOKE = process.env.AI_CHAT_RENAME_SMOKE_TEST === "1"
const DATABASE_URL = process.env.DATABASE_URL

const RUN_ID = randomUUID().slice(0, 8)
const OWNER = `user:rename-smoke-${RUN_ID}-owner`
const FOREIGN = `user:rename-smoke-${RUN_ID}-foreign`
const LANE_KEYS = ["rename-smoke-lane-key"] as const
const THREADS_TABLE = `${AI_CHAT_SCHEMA_NAME}.mastra_threads`

let store: PostgresStore
let memory: Memory
let pool: Pool

async function seedThread(resourceId: string, label: string): Promise<string> {
  const threadId = `rename-smoke-${RUN_ID}-${label}`
  const now = new Date()
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId,
      title: "Old title",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
  })
  return threadId
}

/** The whole row as the database renders it (every column cast to text) —
 * the comparison unit for "nothing but title changed". */
async function readRow(threadId: string): Promise<Record<string, string>> {
  const result = await pool.query<{ row: Record<string, string> }>(
    `SELECT to_jsonb(t) AS row FROM ${THREADS_TABLE} t WHERE id = $1`,
    [threadId],
  )
  expect(result.rowCount).toBe(1)
  return result.rows[0]!.row
}

function omitTitle(row: Record<string, string>): Record<string, string> {
  const rest = { ...row }
  delete rest.title
  return rest
}

function input(body: unknown) {
  return {
    authHeader: `Bearer ${LANE_KEYS[0]}`,
    readJson: async () => body,
    getEnabled: () => true,
    getServiceKeys: () => LANE_KEYS,
    getBackend: () => "postgres" as const,
    getMemory: () => memory,
    getPool: () => pool as unknown as AiChatRenamePool,
  }
}

describe.skipIf(!RUN_SMOKE)(
  "ai-chat rename smoke (real Postgres, opt-in)",
  () => {
    const seeded: string[] = []

    beforeAll(async () => {
      if (!DATABASE_URL) {
        throw new Error(
          "AI_CHAT_RENAME_SMOKE_TEST=1 requires a throwaway DATABASE_URL",
        )
      }
      assertThrowawayDatabaseTarget(DATABASE_URL, "rename")
      store = new PostgresStore({
        id: "ai-chat-rename-smoke",
        connectionString: DATABASE_URL,
        schemaName: AI_CHAT_SCHEMA_NAME,
        max: 2,
      })
      memory = new Memory({ storage: store })
      pool = new Pool({
        connectionString: DATABASE_URL,
        ...AI_CHAT_RENAME_POOL_OPTIONS,
      })
      // Force the store's DDL before the first raw read.
      await memory.getThreadById({ threadId: `rename-smoke-${RUN_ID}-probe` })
    })

    afterAll(async () => {
      try {
        for (const threadId of seeded) await memory.deleteThread(threadId)
      } catch {
        // Cleanup is best-effort; a throwaway DB tolerates residue.
      }
      await pool.end().catch(() => {})
      await (store as unknown as { close?: () => Promise<void> })
        .close?.()
        .catch(() => {})
    })

    it("real-DB half of the trigger pin: mastra_threads carries no user trigger after the store's DDL", async () => {
      const result = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
         WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
        [THREADS_TABLE],
      )
      expect(result.rows).toEqual([])
    })

    it("covers AE1 + AE3: rename stores and echoes the 120-unit clamp and leaves every other column byte-identical", async () => {
      const threadId = await seedThread(OWNER, "owner-1")
      seeded.push(threadId)
      // Backdate the activity stamps so a bump would be unmistakable rather
      // than hidden inside the same second as the seed.
      await pool.query(
        `UPDATE ${THREADS_TABLE}
         SET "updatedAt" = now() - interval '3 days',
             "updatedAtZ" = now() - interval '3 days'
         WHERE id = $1`,
        [threadId],
      )
      const before = await readRow(threadId)
      expect(before.title).toBe("Old title")
      expect(typeof before.updatedAt).toBe("string")

      const outcome = await handleAiChatHistoryRenameRequest(
        input({ resourceId: OWNER, threadId, title: "あ".repeat(130) }),
      )
      expect(outcome.status).toBe(200)
      expect(outcome.body).toEqual({
        ok: true,
        title: "あ".repeat(AI_CHAT_TITLE_MAX_UNITS),
      })

      const after = await readRow(threadId)
      expect(after.title).toBe("あ".repeat(AI_CHAT_TITLE_MAX_UNITS))
      // Every column except title — updatedAt, updatedAtZ, createdAt*,
      // resourceId, metadata — byte-identical as the database renders them.
      expect(omitTitle(after)).toEqual(omitTitle(before))
      expect(after.updatedAt).toBe(before.updatedAt)
      expect(after.updatedAtZ).toBe(before.updatedAtZ)
    })

    it.each([
      {
        label: "split-pair",
        title: "a".repeat(119) + "😀",
        expected: "a".repeat(119) + "\ufffd",
      },
      {
        label: "lone-surrogate",
        title: "before\ud800after",
        expected: "before\ufffdafter",
      },
    ])(
      "echoes the exact stored UTF-8 title for $label",
      async ({ label, title, expected }) => {
        const threadId = await seedThread(OWNER, label)
        seeded.push(threadId)
        const before = await readRow(threadId)
        const outcome = await handleAiChatHistoryRenameRequest(
          input({ resourceId: OWNER, threadId, title }),
        )
        const after = await readRow(threadId)
        expect(outcome).toEqual({
          status: 200,
          body: { ok: true, title: expected },
        })
        expect(after.title).toBe(expected)
        expect(outcome.body).toEqual({ ok: true, title: after.title })
        expect(omitTitle(after)).toEqual(omitTitle(before))
      },
    )

    it("covers AE4 on a real store: a foreign owner is refused and the row is untouched; a missing thread is 404", async () => {
      const threadId = await seedThread(FOREIGN, "foreign-1")
      seeded.push(threadId)
      const before = await readRow(threadId)

      const forbidden = await handleAiChatHistoryRenameRequest(
        input({ resourceId: OWNER, threadId, title: "Hijacked" }),
      )
      expect(forbidden.status).toBe(403)
      expect(forbidden.body).toEqual({ reason: "thread_forbidden" })
      expect(await readRow(threadId)).toEqual(before)

      const missing = await handleAiChatHistoryRenameRequest(
        input({
          resourceId: OWNER,
          threadId: `rename-smoke-${RUN_ID}-missing`,
          title: "Nobody home",
        }),
      )
      expect(missing.status).toBe(404)
      expect(missing.body).toEqual({ reason: "thread_not_found" })
    })
  },
)
