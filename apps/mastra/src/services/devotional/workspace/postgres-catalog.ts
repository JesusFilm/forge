import { randomUUID } from "node:crypto"

import { createInventoryDigest, type CatalogStore } from "./catalog"
import {
  CatalogDocumentSchema,
  CatalogHeadSchema,
  type CatalogDocument,
  type CatalogHead,
} from "./catalog-schema"
import type { DevotionalDatabase, QueryExecutor } from "./database"

type GenerationRow = {
  id: string | number
  inventory_digest: string
  committed_at: Date | string | null
}

type EntryRow = {
  path: string
  category: string
  digest: string
  byte_size: string | number
  modified_at: Date | string
  etag: string | null
  content: string
  metadata: { title?: string } | null
}

const CATALOG_INSERT_BATCH_SIZE = 250

function catalogInsertBatches(documents: CatalogDocument[]) {
  const batches: CatalogDocument[][] = []
  for (
    let index = 0;
    index < documents.length;
    index += CATALOG_INSERT_BATCH_SIZE
  ) {
    batches.push(documents.slice(index, index + CATALOG_INSERT_BATCH_SIZE))
  }
  return batches
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function documentFromRow(row: EntryRow): CatalogDocument {
  return CatalogDocumentSchema.parse({
    path: row.path,
    category: row.category,
    digest: row.digest,
    size: Number(row.byte_size),
    modifiedAt: iso(row.modified_at),
    ...(row.etag ? { etag: row.etag } : {}),
    title: row.metadata?.title ?? row.path.split("/").pop() ?? row.path,
    content: row.content,
  })
}

async function readDocuments(
  database: QueryExecutor,
  generation: number,
): Promise<CatalogDocument[]> {
  const result = await database.query<EntryRow>(
    `SELECT path, category, digest, byte_size, modified_at, etag, content, metadata
       FROM devotional_workspace.catalog_entries
      WHERE generation_id = $1
      ORDER BY path`,
    [generation],
  )
  return result.rows.map(documentFromRow)
}

export class PostgresCatalogStore implements CatalogStore {
  constructor(private readonly database: DevotionalDatabase) {}

  async nextGeneration(): Promise<number> {
    const vectorIndexName = `devotional_gen_${randomUUID().replaceAll("-", "")}`
    const result = await this.database.query<{ id: string | number }>(
      `INSERT INTO devotional_workspace.catalog_generations
         (status, inventory_digest, file_count, decoded_bytes, vector_index_name)
       VALUES ('staging', $1, 0, 0, $2)
       RETURNING id`,
      ["0".repeat(64), vectorIndexName],
    )
    return Number(result.rows[0]!.id)
  }

  async stage(generation: number, documents: CatalogDocument[]): Promise<void> {
    const parsed = documents.map((document) =>
      CatalogDocumentSchema.parse(document),
    )
    await this.database.transaction(async (client) => {
      const locked = await client.query<{ status: string }>(
        `SELECT status FROM devotional_workspace.catalog_generations
          WHERE id = $1 FOR UPDATE`,
        [generation],
      )
      if (locked.rows[0]?.status !== "staging") {
        throw new Error(`Catalog generation ${generation} is not staging`)
      }
      await client.query(
        `DELETE FROM devotional_workspace.catalog_entries
          WHERE generation_id = $1`,
        [generation],
      )
      for (const batch of catalogInsertBatches(parsed)) {
        await client.query(
          `INSERT INTO devotional_workspace.catalog_entries
             (generation_id, path, category, digest, byte_size, modified_at,
              etag, content, metadata)
           SELECT $1, entry.path, entry.category, entry.digest,
                  entry.byte_size, entry.modified_at, entry.etag,
                  entry.content, entry.metadata
             FROM jsonb_to_recordset($2::jsonb) AS entry(
               path text,
               category text,
               digest text,
               byte_size integer,
               modified_at timestamptz,
               etag text,
               content text,
               metadata jsonb
             )`,
          [
            generation,
            JSON.stringify(
              batch.map((document) => ({
                path: document.path,
                category: document.category,
                digest: document.digest,
                byte_size: document.size,
                modified_at: document.modifiedAt,
                etag: document.etag ?? null,
                content: document.content,
                metadata: { title: document.title },
              })),
            ),
          ],
        )
      }
      await client.query(
        `UPDATE devotional_workspace.catalog_generations
            SET inventory_digest = $2, file_count = $3, decoded_bytes = $4
          WHERE id = $1`,
        [
          generation,
          createInventoryDigest(parsed),
          parsed.length,
          parsed.reduce((total, document) => total + document.size, 0),
        ],
      )
    })
  }

  async commit(
    generation: number,
    inventoryDigest: string,
  ): Promise<CatalogHead> {
    const committed = await this.database.transaction(async (client) => {
      const updated = await client.query<{ committed_at: Date | string }>(
        `UPDATE devotional_workspace.catalog_generations
            SET status = 'committed', committed_at = now()
          WHERE id = $1 AND status = 'staging' AND inventory_digest = $2
          RETURNING committed_at`,
        [generation, inventoryDigest],
      )
      if (!updated.rows[0]) {
        throw new Error(`Catalog generation ${generation} cannot be committed`)
      }
      await client.query(
        `INSERT INTO devotional_workspace.catalog_head
           (singleton, generation_id, updated_at)
         VALUES (true, $1, now())
         ON CONFLICT (singleton) DO UPDATE
           SET generation_id = excluded.generation_id,
               updated_at = excluded.updated_at`,
        [generation],
      )
      // Read the committed document set before the transaction completes. If
      // this fails, the head update rolls back and the reconciler may safely
      // delete the uncommitted vector generation.
      const documents = await readDocuments(client, generation)
      return {
        committedAt: iso(updated.rows[0].committed_at),
        documents,
      }
    })
    return CatalogHeadSchema.parse({
      generation,
      inventoryDigest,
      committedAt: committed.committedAt,
      documents: committed.documents,
    })
  }

  async fail(generation: number, message: string): Promise<void> {
    await this.database.query(
      `UPDATE devotional_workspace.catalog_generations
          SET status = 'failed', failure_reason = $2
        WHERE id = $1 AND status = 'staging'`,
      [generation, message.slice(0, 2_000)],
    )
  }

  async getHead(): Promise<CatalogHead | undefined> {
    const result = await this.database.query<GenerationRow>(
      `SELECT generation.id, generation.inventory_digest, generation.committed_at
         FROM devotional_workspace.catalog_head head
         JOIN devotional_workspace.catalog_generations generation
           ON generation.id = head.generation_id
        WHERE head.singleton = true AND generation.status = 'committed'`,
    )
    const row = result.rows[0]
    if (!row?.committed_at) return undefined
    const generation = Number(row.id)
    return CatalogHeadSchema.parse({
      generation,
      inventoryDigest: row.inventory_digest,
      committedAt: iso(row.committed_at),
      documents: await this.getGeneration(generation),
    })
  }

  getGeneration(generation: number): Promise<CatalogDocument[]> {
    return readDocuments(this.database, generation)
  }

  async retireBefore(generation: number): Promise<number[]> {
    return this.database.transaction(async (client) => {
      await client.query(
        `UPDATE devotional_workspace.catalog_generations generation
            SET status = 'retired', retired_at = now()
          WHERE generation.id < $1
            AND generation.status = 'committed'
            AND NOT EXISTS (
              SELECT 1 FROM devotional_workspace.catalog_head head
               WHERE head.generation_id = generation.id
            )`,
        [generation],
      )
      // Attempt rows retain the generation identity and their bounded selected
      // refs. Superseded full content is no longer needed for execution.
      await client.query(
        `DELETE FROM devotional_workspace.catalog_entries entry
          USING devotional_workspace.catalog_generations generation
          WHERE entry.generation_id = generation.id
            AND generation.status = 'retired'
            AND generation.id < $1`,
        [generation],
      )
      const retired = await client.query<{ id: string | number }>(
        `SELECT id
           FROM devotional_workspace.catalog_generations
          WHERE status = 'retired' AND id < $1
          ORDER BY id`,
        [generation],
      )
      // Returning every retired generation makes failed vector-index cleanup
      // retryable on the next reconciliation.
      return retired.rows.map(({ id }) => Number(id))
    })
  }
}
