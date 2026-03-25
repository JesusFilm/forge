/**
 * PostgreSQL-backed state tracking for the data-import pipeline.
 * Replaces the file-based `.last-import` marker that doesn't survive
 * Railway's ephemeral filesystem.
 */

import pg from "pg"

export async function createImportClient(
  databaseUrl: string,
): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  return client
}

export async function ensureImportTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _data_imports (
      id SERIAL PRIMARY KEY,
      snapshot_key TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

export async function getLastAppliedKey(
  client: pg.Client,
): Promise<string | null> {
  const result = await client.query<{ snapshot_key: string }>(
    "SELECT snapshot_key FROM _data_imports ORDER BY applied_at DESC LIMIT 1",
  )
  return result.rows[0]?.snapshot_key ?? null
}

export async function recordImport(
  client: pg.Client,
  snapshotKey: string,
): Promise<void> {
  await client.query("INSERT INTO _data_imports (snapshot_key) VALUES ($1)", [
    snapshotKey,
  ])
}
