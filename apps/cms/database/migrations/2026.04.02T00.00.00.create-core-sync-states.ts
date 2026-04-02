/**
 * Create the core_sync_states table used by the core-sync service to track
 * per-phase watermarks and last-run statistics.
 *
 * Previously this table was created at runtime by ensureSyncStateTable().
 * Moving it to a proper migration ensures the schema exists on boot,
 * before any status endpoint queries it.
 */

const TABLE = "core_sync_states"

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  const exists = await knex.schema.hasTable(TABLE)

  if (!exists) {
    await knex.schema.createTable(TABLE, (t: any) => {
      t.string("phase").primary()
      t.timestamp("last_synced_at").notNullable()
      t.integer("created").defaultTo(0)
      t.integer("updated").defaultTo(0)
      t.integer("soft_deleted").defaultTo(0)
      t.integer("errors").defaultTo(0)
    })
    return
  }

  // Table exists from the old runtime creation — add stats columns if missing
  const hasCreated = await knex.schema.hasColumn(TABLE, "created")
  if (!hasCreated) {
    await knex.schema.alterTable(TABLE, (t: any) => {
      t.integer("created").defaultTo(0)
      t.integer("updated").defaultTo(0)
      t.integer("soft_deleted").defaultTo(0)
      t.integer("errors").defaultTo(0)
    })
  }
}

export async function down(knex: any): Promise<void> {
  await knex.schema.dropTableIfExists(TABLE)
}
