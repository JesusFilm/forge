/**
 * In-memory RawDocumentReader fake for Indexing unit tests. Seeded with pending
 * staging rows; listPending returns the not-yet-marked rows (optionally scoped by
 * sourceKey/limit) and markIngested records which ids were consumed — mirroring
 * the real adapter's `ingested_at IS NULL` drain without Postgres. Inspection
 * getters let tests assert exactly what was marked.
 */
import type {
  PendingRawDocument,
  RawDocumentReader,
} from "../contracts/index.js"

export class FakeRawDocumentReader implements RawDocumentReader {
  private readonly pending: PendingRawDocument[]
  private readonly ingested = new Set<string>()

  constructor(pending: PendingRawDocument[] = []) {
    this.pending = pending.map((d) => ({ ...d }))
  }

  async listPending(
    opts: {
      sourceKey?: string
      limit?: number
      includeIngested?: boolean
    } = {},
  ): Promise<PendingRawDocument[]> {
    let rows = opts.includeIngested
      ? this.pending
      : this.pending.filter((d) => !this.ingested.has(d.id))
    if (opts.sourceKey)
      rows = rows.filter((d) => d.sourceKey === opts.sourceKey)
    if (opts.limit != null) rows = rows.slice(0, opts.limit)
    return rows.map((d) => ({ ...d }))
  }

  async markIngested(ids: string[], _attemptedModel?: string): Promise<void> {
    for (const id of ids) this.ingested.add(id)
  }

  // --- inspection (test helpers) -------------------------------------------

  isIngested(id: string): boolean {
    return this.ingested.has(id)
  }

  ingestedCount(): number {
    return this.ingested.size
  }
}
