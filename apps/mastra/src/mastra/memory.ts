/**
 * Seeker-agent Memory primitive (feat-198, U2).
 *
 * Wires `@mastra/memory`'s `Memory` against a DEDICATED in-memory store,
 * independent of `index.ts`'s `MASTRA_STORAGE_BACKEND` switch. The seeker
 * skeleton's memory is ALWAYS in-memory and therefore physically cannot
 * persist to Postgres — honoring the brainstorm's "no Postgres-persisted
 * memory" deferral unconditionally (KTD1). It wipes on process restart, not
 * per session.
 *
 * This module is the single-responsibility seam where the eventual
 * in-memory -> Postgres/PgVector swap lands later. The wiring shape
 * (`new Memory({ storage })`) is identical to the persisted path, so this
 * choice does not complicate the future build-out.
 *
 * Mirrors the lazy-singleton + `__reset*ForTesting` SHAPE of
 * `apps/admin/src/mastra/memory.ts`, stripped to in-memory only (no Postgres,
 * no PgVector, no embedder, no env reads). Admin is a reference to copy from,
 * NEVER an import — `apps/mastra` must not import `apps/admin`. Two distinct
 * reasons, two distinct docs:
 *   - copy-not-import convention:
 *     `docs/solutions/architecture-patterns/mastra-seed-baseline-portability-pattern.md`
 *   - the real tsx/ESM cross-package-boundary load-time crash that makes the
 *     import not just disallowed but unsafe:
 *     `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`
 */

import { Memory } from "@mastra/memory"
import { InMemoryStore } from "@mastra/core/storage"

/**
 * Build the seeker Memory instance against its own `InMemoryStore`. Pure
 * factory — the store is the same class `index.ts` uses for its
 * `MASTRA_STORAGE_BACKEND === "memory"` path, but this is a SEPARATE instance
 * so the seeker's memory never shares state with (or persists through) the
 * app-level store.
 */
export function buildSeekerMemory(): Memory {
  return new Memory({
    storage: new InMemoryStore({ id: "seeker-memory-storage" }),
  })
}

/**
 * Singleton Memory instance for the seeker agent.
 *
 * Why a singleton: Mastra's Memory primitive owns its backing store; a single
 * instance keeps every read/write against the same in-memory state for the
 * process lifetime. Construction is lazy so importing this module in a
 * build-phase context does not eagerly allocate the store.
 */
let cached: Memory | null = null

export function getSeekerMemory(): Memory {
  if (cached === null) {
    cached = buildSeekerMemory()
  }
  return cached
}

/**
 * Test-only reset hook. Production code never resets the singleton — the
 * cached instance is the whole point. Tests use this to start from a fresh
 * in-memory store between cases.
 */
export function __resetSeekerMemoryForTesting(): void {
  cached = null
}
