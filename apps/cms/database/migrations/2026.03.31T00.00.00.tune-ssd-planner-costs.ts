/**
 * Tune PostgreSQL planner cost parameters for SSD storage.
 *
 * Railway uses SSD-backed storage, but PostgreSQL defaults to
 * random_page_cost = 4, which is tuned for spinning disks.
 * This makes the planner heavily penalise index scans (random I/O)
 * and prefer sequential scans even when good indexes exist.
 *
 * On SSDs, random reads are nearly as fast as sequential reads.
 * Setting random_page_cost = 1.1 (per PostgreSQL docs recommendation
 * for SSDs) allows the planner to choose index scans when appropriate.
 *
 * ALTER DATABASE ... SET persists across restarts and applies to all
 * new connections without requiring postgresql.conf access.
 */

const EFFECTIVE_IO_CONCURRENCY_PARAMETER = "effective_io_concurrency"
const EFFECTIVE_IO_CONCURRENCY_SAVEPOINT = "effective_io_concurrency_probe"

type PostgresErrorLike = Error & {
  code?: string
}

function isUnsupportedEffectiveIoConcurrencyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const postgresError = error as PostgresErrorLike

  // This catch only wraps ALTER DATABASE ... SET effective_io_concurrency = 200.
  // Match SQLSTATE plus parameter context so the guard still works when the
  // server localizes the human-readable detail text.
  return (
    postgresError.code === "22023" &&
    error.message.includes(EFFECTIVE_IO_CONCURRENCY_PARAMETER)
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function setEffectiveIoConcurrencyIfSupported(
  knex: any,
  dbName: string,
): Promise<void> {
  // Strapi wraps user migrations in a transaction. Probe the database setting
  // inside a savepoint so unsupported platforms don't abort the whole migration.
  await knex.raw(`SAVEPOINT ${EFFECTIVE_IO_CONCURRENCY_SAVEPOINT}`)
  try {
    await knex.raw(
      `ALTER DATABASE "${dbName}" SET effective_io_concurrency = 200`,
    )
    await knex.raw(`RELEASE SAVEPOINT ${EFFECTIVE_IO_CONCURRENCY_SAVEPOINT}`)
  } catch (error) {
    await knex.raw(
      `ROLLBACK TO SAVEPOINT ${EFFECTIVE_IO_CONCURRENCY_SAVEPOINT}`,
    )
    await knex.raw(`RELEASE SAVEPOINT ${EFFECTIVE_IO_CONCURRENCY_SAVEPOINT}`)

    if (isUnsupportedEffectiveIoConcurrencyError(error)) {
      return
    }

    throw error
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  const [{ current_database: dbName }] = await knex
    .raw("SELECT current_database()")
    .then((r: any) => r.rows ?? r)

  await knex.raw(`ALTER DATABASE "${dbName}" SET random_page_cost = 1.1`)

  // Keep SSD tuning on supported hosts, but skip local platforms that force 0.
  await setEffectiveIoConcurrencyIfSupported(knex, dbName)
}

export async function down(knex: any): Promise<void> {
  const [{ current_database: dbName }] = await knex
    .raw("SELECT current_database()")
    .then((r: any) => r.rows ?? r)

  await knex.raw(`ALTER DATABASE "${dbName}" RESET random_page_cost`)
  await knex.raw(`ALTER DATABASE "${dbName}" RESET effective_io_concurrency`)
}
