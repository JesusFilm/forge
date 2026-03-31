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

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  const [{ current_database: dbName }] = await knex
    .raw("SELECT current_database()")
    .then((r: any) => r.rows ?? r)

  await knex.raw(`ALTER DATABASE "${dbName}" SET random_page_cost = 1.1`)

  // Also set effective_io_concurrency for SSD (default 1 is for HDD)
  await knex.raw(
    `ALTER DATABASE "${dbName}" SET effective_io_concurrency = 200`,
  )
}

export async function down(knex: any): Promise<void> {
  const [{ current_database: dbName }] = await knex
    .raw("SELECT current_database()")
    .then((r: any) => r.rows ?? r)

  await knex.raw(`ALTER DATABASE "${dbName}" RESET random_page_cost`)
  await knex.raw(`ALTER DATABASE "${dbName}" RESET effective_io_concurrency`)
}
