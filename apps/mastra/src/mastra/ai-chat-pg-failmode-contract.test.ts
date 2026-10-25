/**
 * Pinned-`@mastra/pg` fail-mode contract guard (feat-208, plan fact 5).
 *
 * The ai-chat ownership gate's fail-CLOSED guarantee (`ai-chat-thread-
 * ownership.ts`) and the retention purge's outage probe (`ai-chat-retention.ts`)
 * both rest on the same load-bearing behavior: a store outage makes a thread
 * READ reject — it must never silently resolve as "no such thread". If it did,
 * the ownership gate would fall through to the ceiling branch and return
 * `ok:true` (a cross-resource fail-OPEN), and the purge would log a false
 * `purge_complete scanned=0`. Every other ai-chat test fakes the Memory
 * surface, so none observes this against the REAL package. This exercises the
 * production surface — `Memory` over a `PostgresStore` — against an unreachable
 * connection, so a future `@mastra/*` bump that swallows store errors on the
 * read path fails CI here, not production log-watching.
 *
 * Scope: pins the security-critical fail-CLOSED direction (a hard outage → the
 * read rejects). The finer per-query behaviors — `listThreads` SWALLOWing a
 * post-init transient fault (fact 6) and `getThreadById` returning null for a
 * MISSING id (fact 7) — need a reachable store and stay covered by the plan's
 * real-Postgres smoke. On an `@mastra/*` bump, re-derive from plan facts 5-7;
 * do NOT just loosen the assertion.
 */
import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"
import { afterAll, describe, expect, it } from "vitest"

// Loopback port 1 has nothing listening, so the first store I/O rejects with a
// connection error immediately — a deterministic hard outage that needs no
// provisioned database (CI-safe and fast).
const UNREACHABLE =
  "postgresql://postgres:postgres@127.0.0.1:1/forge_failmode_probe"

const store = new PostgresStore({
  id: "ai-chat-failmode-contract",
  connectionString: UNREACHABLE,
  schemaName: "ai_chat",
  max: 1,
})
// Production passes `new Memory({ storage: getAiChatStorage() })`; going through
// Memory also guards `@mastra/memory` delegating the read to the store without
// swallowing on its own.
const memory = new Memory({ storage: store })

afterAll(async () => {
  // Release the pool so a refused-connection store can't hold the run open.
  await (store as unknown as { close?: () => Promise<void> })
    .close?.()
    .catch(() => {})
})

describe("@mastra/pg fail-mode contract (feat-208 fact 5)", () => {
  it("a store outage makes Memory.getThreadById REJECT, never resolve null (ownership fail-CLOSED + retention probe fires)", async () => {
    await expect(
      memory.getThreadById({ threadId: "irrelevant-on-a-dead-store" }),
    ).rejects.toThrow()
  })
})
