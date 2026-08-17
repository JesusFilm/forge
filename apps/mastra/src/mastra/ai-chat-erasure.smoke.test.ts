import { randomUUID } from "node:crypto"

import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { env } from "../config/env"

import { AI_CHAT_SCHEMA_NAME } from "./ai-chat-memory"
import {
  executeAiChatErasure,
  previewAiChatErasure,
  type AiChatErasureMemory,
} from "./ai-chat-erasure"

/**
 * Opt-in REAL-POSTGRES erasure smoke (feat-337 U3). Proves against a live
 * store what mocked SQL-shape tests structurally cannot: that
 * `listThreads({ filter: { resourceId } })` is a genuine EXACT-match filter
 * (not a prefix or LIKE), and that `deleteThread` really removes the target's
 * threads AND their messages.
 *
 * Why the mocked suite is not enough: every store fake in
 * `ai-chat-erasure.test.ts` implements the filter as `===` because that is
 * what the contract says. If `@mastra/pg` ever resolved it as a prefix match
 * — or if a future bump changed the argument name and the filter silently
 * became a no-op returning EVERY thread — the mocked suite would stay green
 * while a production erasure took a neighbour's data with it. That is the
 * failure this suite exists to catch, which is why the fixture is a
 * prefix-ADJACENT pair (`…-a` and `…-ab`, so one key is a strict prefix of
 * the other) rather than two unrelated keys.
 *
 * DELIBERATELY OUT OF CI, and skipped (not failed) by default: it needs a
 * provisioned Postgres and it WRITES AND DELETES rows. Only the literal
 * `AI_CHAT_ERASURE_SMOKE_TEST=1` enables it, mirroring
 * `LANGFUSE_TRACE_RETENTION_SMOKE_TEST` / `LANGFUSE_PROMPT_SMOKE_TEST`.
 *
 * ── Run it (against a THROWAWAY database — never production) ────────────────
 *
 *   AI_CHAT_ERASURE_SMOKE_TEST=1 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forge_erasure_smoke \
 *   pnpm --filter @forge/mastra test -- ai-chat-erasure.smoke
 *
 * `PostgresStore` runs its own DDL at init, so an empty database is enough —
 * the `ai_chat` schema and tables are created on first use.
 *
 * ── Langfuse posture ───────────────────────────────────────────────────────
 *
 * The operator shell running this may hold REAL production Langfuse
 * credentials (the runbook's sourcing idiom exports the whole `LANGFUSE_*`
 * group), and the Langfuse project is always production — a stray delete here
 * would destroy real traces and spend the org-wide daily quota. So the suite
 * asserts, at the boundary, that the erasure path issues ZERO outbound HTTP
 * requests: `globalThis.fetch` is replaced with a recorder for the duration,
 * and any call at all fails the suite. In PR 1 the Langfuse half is
 * `not_implemented`, so this pins "by construction" rather than "by
 * configuration"; PR 2's U6 keeps the same pin with a genuinely unconfigured
 * Langfuse seam once the half exists.
 */

const RUN_SMOKE = env.AI_CHAT_ERASURE_SMOKE_TEST === "1"

// Prefix-adjacent by construction: TARGET is a strict prefix of NEIGHBOUR, so
// a prefix/LIKE filter regression cannot pass this suite. The random suffix
// keeps concurrent or repeated runs from colliding on a shared throwaway DB.
const RUN_ID = randomUUID().slice(0, 8)
const TARGET_RESOURCE = `user:erasure-smoke-${RUN_ID}-a`
const NEIGHBOUR_RESOURCE = `user:erasure-smoke-${RUN_ID}-ab`

/**
 * Refuse a target that does not look disposable, rather than only documenting
 * "use a throwaway database" in the header above. This suite SEEDS AND DELETES
 * rows, and the operator shell most likely to run it is the same one that
 * holds production credentials — the runbook's own sourcing idiom exports a
 * whole env group. A prose warning is not a control; this is.
 *
 * Accepted: a loopback host is treated as disposable on its own, and any host
 * is accepted when the database NAME says throwaway. A production database
 * called `..._test` would slip through, which is why this is a guard against
 * the realistic accident (a stale `DATABASE_URL` still exported from an
 * earlier task), not a claim of proof.
 */
function assertThrowawayTarget(databaseUrl: string): void {
  // Independent second axis beside the URL shape below: the Railway console
  // sets NODE_ENV=production and vitest never overrides a pre-set value, so
  // this refuses a production RUNTIME even if its database were named to
  // slip the pattern. It cannot catch a laptop pointed at production — the
  // URL check owns that side.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "refusing to run the erasure smoke in a production runtime (NODE_ENV=production)",
    )
  }
  const url = new URL(databaseUrl)
  // Deny BEFORE the allowlist: Railway hostnames (railway.internal,
  // railway.app, and the proxy domain rlwy.net) mark a real deployed
  // database, and Railway's default database NAME is literally "railway" —
  // a Railway DB named like a test database must still refuse.
  if (/railway|rlwy/i.test(url.hostname)) {
    throw new Error(
      "refusing to run the erasure smoke against a Railway-hosted database (hostname matches railway/rlwy)",
    )
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    url.hostname,
  )
  const database = url.pathname.replace(/^\/+/, "")
  if (loopback || /(test|smoke|throwaway|scratch)/i.test(database)) return
  throw new Error(
    "refusing to run the erasure smoke against a target that does not look disposable: " +
      "point DATABASE_URL at a loopback host, or name the database with test/smoke/throwaway/scratch",
  )
}

let store: PostgresStore
let memory: Memory
let acquireMemory: () => { ok: true; memory: AiChatErasureMemory }
let realFetch: typeof globalThis.fetch
let fetchCalls: string[]

async function seedThread(resourceId: string, label: string): Promise<string> {
  const threadId = `erasure-smoke-${RUN_ID}-${label}`
  const now = new Date()
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId,
      title: "",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
  })
  await memory.saveMessages({
    messages: [
      {
        id: `${threadId}-m1`,
        role: "user",
        threadId,
        resourceId,
        createdAt: now,
        content: {
          format: 2,
          parts: [{ type: "text", text: "smoke fixture message" }],
          content: "smoke fixture message",
        },
      },
    ],
  })
  return threadId
}

async function threadIdsFor(resourceId: string): Promise<string[]> {
  const result = await memory.listThreads({
    filter: { resourceId },
    page: 0,
    perPage: 100,
  })
  return result.threads.map((thread) => thread.id)
}

describe.skipIf(!RUN_SMOKE)(
  "ai-chat erasure smoke (real Postgres, opt-in)",
  () => {
    beforeAll(async () => {
      if (!env.DATABASE_URL) {
        throw new Error(
          "AI_CHAT_ERASURE_SMOKE_TEST=1 requires a throwaway DATABASE_URL",
        )
      }
      assertThrowawayTarget(env.DATABASE_URL)
      store = new PostgresStore({
        id: "ai-chat-erasure-smoke",
        connectionString: env.DATABASE_URL,
        schemaName: AI_CHAT_SCHEMA_NAME,
        max: 2,
      })
      memory = new Memory({ storage: store })
      acquireMemory = () => ({
        ok: true,
        memory: memory as unknown as AiChatErasureMemory,
      })

      realFetch = globalThis.fetch
      fetchCalls = []
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        fetchCalls.push(String(input))
        return realFetch(input as RequestInfo, init)
      }) as typeof globalThis.fetch
    })

    afterAll(async () => {
      globalThis.fetch = realFetch
      // Best-effort cleanup of the neighbour fixture the suite deliberately
      // leaves intact, then release the pool.
      try {
        for (const threadId of await threadIdsFor(NEIGHBOUR_RESOURCE)) {
          await memory.deleteThread(threadId)
        }
      } catch {
        // Cleanup is best-effort; a throwaway DB tolerates residue.
      }
      await (store as unknown as { close?: () => Promise<void> })
        .close?.()
        .catch(() => {})
    })

    it("erases the target's threads and messages and leaves the prefix-adjacent neighbour intact (AE1)", async () => {
      const targetThreadA = await seedThread(TARGET_RESOURCE, "target-1")
      const targetThreadB = await seedThread(TARGET_RESOURCE, "target-2")
      const neighbourThread = await seedThread(NEIGHBOUR_RESOURCE, "neighbour")

      // Anti-vacuous: the fixture must actually be there before the erasure,
      // or "gone afterwards" proves nothing.
      expect(await threadIdsFor(TARGET_RESOURCE)).toEqual(
        expect.arrayContaining([targetThreadA, targetThreadB]),
      )

      const result = await executeAiChatErasure({
        resourceId: TARGET_RESOURCE,
        acquireMemory,
        log: { info: () => {}, warn: () => {} },
      })

      expect(result).toMatchObject({
        kind: "completed",
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 2 },
      })
      expect(await threadIdsFor(TARGET_RESOURCE)).toEqual([])

      // The neighbour's thread AND its messages survive. `recall` throwing
      // would mean the thread vanished — the exact cross-user damage a
      // prefix-matching filter would cause.
      expect(await threadIdsFor(NEIGHBOUR_RESOURCE)).toEqual([neighbourThread])
      const recalled = await memory.recall({
        threadId: neighbourThread,
        resourceId: NEIGHBOUR_RESOURCE,
        perPage: 50,
      })
      expect(recalled.messages).toHaveLength(1)

      // The target's messages went with the threads (`deleteThread`'s cascade
      // — the coverage the old runbook SQL's message DELETE only approximated).
      await expect(
        memory.recall({
          threadId: targetThreadA,
          resourceId: TARGET_RESOURCE,
          perPage: 50,
        }),
      ).rejects.toThrow()
    })

    it("reports a follow-up preview of the erased key as no-data, not a successful erasure (AE7)", async () => {
      const preview = await previewAiChatErasure({
        resourceId: TARGET_RESOURCE,
        acquireMemory,
        log: { info: () => {}, warn: () => {} },
      })
      expect(preview).toMatchObject({
        mode: "preview",
        postgres: { kind: "no_data" },
      })

      const rerun = await executeAiChatErasure({
        resourceId: TARGET_RESOURCE,
        acquireMemory,
        log: { info: () => {}, warn: () => {} },
      })
      expect(rerun).toMatchObject({ postgres: { kind: "no_data" } })
    })

    it("issues zero outbound HTTP requests — no Langfuse traffic on any path", () => {
      expect(fetchCalls).toEqual([])
    })
  },
)
