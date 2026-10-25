const quote = (identifier: string): string => `"${identifier}"`

type CorpusBatchTarget = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>
}

/**
 * Indexing-owned primitive for inserting one already-embedded migration batch.
 * The operator script owns source reads and verification; this boundary owns
 * the only target corpus write used by the migration.
 */
export async function insertCorpusBatch(
  target: CorpusBatchTarget,
  table: string,
  cursor: string,
  columns: readonly string[],
  rows: unknown[],
): Promise<void> {
  const columnList = columns.map(quote).join(", ")
  await target.$executeRawUnsafe(
    `INSERT INTO ${quote(table)} (${columnList})
     SELECT ${columnList}
     FROM jsonb_populate_recordset(NULL::${quote(table)}, $1::jsonb)
     ON CONFLICT (${quote(cursor)}) DO NOTHING`,
    JSON.stringify(rows),
  )
}
