/**
 * Mastra Memory primitive — admin Experience-AI chat (U2).
 *
 * Storage choice and rationale: Postgres via `@mastra/pg`, against the
 * same Postgres instance admin already operates. Chosen in the U1
 * fitness spike (see
 * `docs/solutions/platform/admin-chat-mastra-fitness-spike-20260514.md`)
 * over LibSQL because:
 *
 * 1. Operational continuity — admin already runs Postgres on Railway
 *    with backups and monitoring; adding a parallel SQLite-style
 *    storage tier is unjustified at admin's scale.
 * 2. ABAC alignment — keeping memory in the same DB as ABAC-gated
 *    rows simplifies eventual auditing / joining if we ever need it.
 * 3. LibSQL stays documented as a one-line fallback if pool contention
 *    with admin's existing Prisma `connection_limit=10` surfaces.
 *
 * Per-call keying convention (enforced by agent code in U6+, NOT by
 * this module):
 *   - `threadId` = `experienceLocaleId`
 *   - `resourceId` = `principalId`
 *
 * Memory's row-level access is keyed by `resourceId`, so storing the
 * principal id there aligns memory scoping to ABAC by construction.
 * Old chat history is NOT preserved — per origin's "cold cutover"
 * decision, the legacy `experienceChatThread` / `experienceChatMessage`
 * Prisma tables are dropped in plan U10. New threads start in this
 * Mastra-managed storage.
 *
 * Connection-string fallback: `MASTRA_STORAGE_URL` is the explicit
 * pointer; if unset, fall back to `DATABASE_URL` so the default-deploy
 * path works without an extra Doppler entry. The fallback is a
 * deliberate scaffolding-env-var pattern per
 * `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`.
 */

import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"

import { env } from "@/config/env"

/**
 * Resolve the Mastra storage connection string with documented
 * fallback to admin's primary DATABASE_URL. Exported separately so
 * tests and tooling can probe the resolution without instantiating
 * the full Memory primitive.
 */
export function resolveMastraStorageUrl(): string {
  return env.MASTRA_STORAGE_URL ?? env.DATABASE_URL
}

/**
 * Build the Mastra Memory instance for admin's Experience-AI chat.
 * Pure factory — does not open a connection at construction time.
 * The pool is established on the first storage read/write.
 */
export function buildMastraMemory(): Memory {
  const storage = new PostgresStore({
    id: "admin-chat-memory",
    connectionString: resolveMastraStorageUrl(),
  })
  return new Memory({ storage })
}

/**
 * Singleton Memory instance shared by all admin chat agents.
 *
 * Why a singleton: Mastra's Memory primitive owns its own connection
 * pool internally; constructing multiple instances would multiply
 * pool capacity unnecessarily. Agents and workflows that need memory
 * import this same instance.
 *
 * Construction is lazy (deferred to first access) so that importing
 * the surrounding module in a build-phase context (where env may be
 * empty) does not open a doomed connection pool.
 */
let cached: Memory | null = null

export function getMastraMemory(): Memory {
  if (cached === null) {
    cached = buildMastraMemory()
  }
  return cached
}

/**
 * Test-only reset hook. Production code never resets the singleton —
 * the cached instance is the whole point. Tests use this to swap the
 * underlying storage between cases without leaking across them.
 */
export function __resetMastraMemoryForTesting(): void {
  cached = null
}
