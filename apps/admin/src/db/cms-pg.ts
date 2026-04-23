// cms Postgres connection — used by R3's experience-content-dump
// workflow to read Strapi v5 content directly from cms's database.
//
// The pool is intentionally lazy: admin still boots in environments
// where CMS_DATABASE_URL is unset (dev machines, CI, prod before the
// read-only role is provisioned). Calling getCmsPgPool() without the
// env throws CmsDatabaseUrlMissingError so the failure surfaces at
// the workflow boundary rather than at admin startup.
//
// Why a separate Pool (not Prisma): admin's Prisma client is bound to
// admin's schema. cms uses a Strapi v5 schema admin doesn't model.
// We read raw SQL via `pg`, returning typed rows through the
// `cms-experience-source.repository.ts` layer (Unit 3).
//
// Why `pg` directly (not e.g. postgres.js): cms's stack already uses
// `pg@8.x` — one driver across the monorepo means one set of driver-
// specific gotchas to remember (PG18 array casting, snake_case column
// names — see CLAUDE.md "Common pitfalls").
//
// Why a small connection pool (max=5): the dump is a periodic-rerun
// workload, not a hot path. A small ceiling keeps us off cms's
// connection slots between runs and stays comfortably below the
// per-database default limit on Railway PG.
//
// HMR-safety mirrors `src/db/client.ts`: under Next.js dev reloads we
// reuse the existing pool from `globalThis` instead of leaking a new
// one on every reload.

import { Pool, type PoolClient, type QueryResult } from "pg"
import { env } from "@/config/env"

const CMS_PG_MAX_CONNECTIONS = 5
const CMS_PG_IDLE_TIMEOUT_MS = 30_000
const CMS_PG_CONNECTION_TIMEOUT_MS = 10_000

const globalForCmsPg = globalThis as unknown as {
  cmsPgPool?: Pool
}

/**
 * Thrown when a runtime caller tries to read cms before
 * `CMS_DATABASE_URL` has been provisioned. The workflow surface
 * catches this and reports it back through the per-target outcome so
 * the operator sees a clear configuration failure rather than a
 * connection-refused stack trace.
 */
export class CmsDatabaseUrlMissingError extends Error {
  readonly code = "cms_database_url_missing" as const
  constructor(message?: string) {
    super(
      message ??
        "CMS_DATABASE_URL is required for the experience-content-dump workflow. Set it on the forge-admin Doppler project (read-only Postgres role recommended).",
    )
    this.name = "CmsDatabaseUrlMissingError"
  }
}

/**
 * Lazily-constructed singleton `pg.Pool` bound to `CMS_DATABASE_URL`.
 *
 * Throws `CmsDatabaseUrlMissingError` synchronously when the env is
 * unset — admin still boots without it, but the dump workflow cannot
 * run.
 */
export function getCmsPgPool(): Pool {
  if (globalForCmsPg.cmsPgPool !== undefined) {
    return globalForCmsPg.cmsPgPool
  }
  const url = env.CMS_DATABASE_URL
  if (!url) {
    throw new CmsDatabaseUrlMissingError()
  }
  const pool = new Pool({
    connectionString: url,
    max: CMS_PG_MAX_CONNECTIONS,
    idleTimeoutMillis: CMS_PG_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CMS_PG_CONNECTION_TIMEOUT_MS,
  })
  globalForCmsPg.cmsPgPool = pool
  return pool
}

/**
 * Re-exported pg types so callers depend on this module rather than
 * pulling `pg` directly. Read shapes only — the dump is a read-only
 * workload, and admin's coding boundary makes that explicit.
 */
export type CmsPgPoolClient = PoolClient
export type CmsPgQueryResult<T extends Record<string, unknown>> = QueryResult<T>

/**
 * Test-only escape hatch: drop the cached pool so a subsequent
 * `getCmsPgPool()` call re-reads env. Production code MUST NOT call
 * this — the singleton is intentional. The leading underscore + the
 * `forTests` suffix together telegraph that.
 */
export function _resetCmsPgPoolForTests(): void {
  globalForCmsPg.cmsPgPool = undefined
}
