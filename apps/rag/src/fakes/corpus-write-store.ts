/**
 * In-memory CorpusWriteStore fake for Indexing unit tests. Models the
 * load-bearing write semantics without Postgres:
 *  - upsertSource is required before replaceDocument (same guard as the real
 *    adapter — a missing source is a bug, not a silent insert);
 *  - replaceDocument is delete-then-insert: replacing a document's entry
 *    wholesale drops its previous chunks, so re-indexing never double-indexes.
 * Inspection getters let tests assert exactly what was written.
 */
import { randomUUID } from "node:crypto"
import type {
  CorpusWriteStore,
  DedupRecord,
  EmbeddedChunk,
  NormalizedDocument,
  SourceRecord,
} from "../contracts/index.js"

export interface StoredDocument {
  id: string
  sourceId: string
  doc: NormalizedDocument
  chunks: EmbeddedChunk[]
}

const docKey = (sourceKey: string, canonicalUrl: string): string =>
  `${sourceKey}\n${canonicalUrl}`

export class FakeCorpusWriteStore implements CorpusWriteStore {
  private readonly sources = new Map<
    string,
    { id: string; record: SourceRecord }
  >()
  private readonly documents = new Map<string, StoredDocument>()

  async upsertSource(source: SourceRecord): Promise<string> {
    const id = this.sources.get(source.key)?.id ?? randomUUID()
    this.sources.set(source.key, { id, record: { ...source } })
    return id
  }

  async getDedup(
    sourceKey: string,
    canonicalUrl: string,
  ): Promise<DedupRecord | null> {
    const stored = this.documents.get(docKey(sourceKey, canonicalUrl))
    if (!stored) return null
    // A document is written atomically on one model, so any chunk represents it;
    // null when it has no chunks (mirrors the adapter's left-joined model).
    return {
      contentHash: stored.doc.contentHash,
      embeddingModel: stored.chunks[0]?.embeddingModel ?? null,
    }
  }

  async replaceDocument(
    doc: NormalizedDocument,
    chunks: EmbeddedChunk[],
    _staging?: { rawDocumentId: string; attemptedModel: string },
  ): Promise<void> {
    const source = this.sources.get(doc.sourceKey)
    if (!source) {
      throw new Error(
        `replaceDocument: unknown source key '${doc.sourceKey}' — call upsertSource first`,
      )
    }
    const key = docKey(doc.sourceKey, doc.canonicalUrl)
    const id = this.documents.get(key)?.id ?? randomUUID()
    this.documents.set(key, {
      id,
      sourceId: source.id,
      doc: { ...doc },
      chunks: chunks.map((c) => ({ ...c })),
    })
  }

  // --- inspection (test helpers) -------------------------------------------

  getSource(key: string): SourceRecord | null {
    return this.sources.get(key)?.record ?? null
  }

  getDocument(sourceKey: string, canonicalUrl: string): StoredDocument | null {
    return this.documents.get(docKey(sourceKey, canonicalUrl)) ?? null
  }

  allDocuments(): StoredDocument[] {
    return [...this.documents.values()]
  }

  totalChunks(): number {
    let n = 0
    for (const d of this.documents.values()) n += d.chunks.length
    return n
  }
}
