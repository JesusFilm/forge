/**
 * In-memory RawDocumentStore fake for Acquisition unit tests. Models the one
 * load-bearing write semantic without Postgres: putRawDocument is idempotent per
 * (sourceKey, canonicalUrl) — re-acquiring the same page replaces the prior row
 * rather than appending, so a re-run does not accumulate duplicate staging rows.
 * (The fake holds only un-ingested rows, mirroring what Acquisition writes.)
 * Inspection getters let tests assert exactly what was staged.
 */
import type { RawDocument, RawDocumentStore } from "../contracts/index.js"

const key = (sourceKey: string, canonicalUrl: string): string =>
  `${sourceKey}\n${canonicalUrl}`

export class FakeRawDocumentStore implements RawDocumentStore {
  private readonly rows = new Map<string, RawDocument>()

  async putRawDocument(doc: RawDocument): Promise<void> {
    this.rows.set(key(doc.sourceKey, doc.canonicalUrl), { ...doc })
  }

  async listStagedCanonicalUrls(sourceKey: string): Promise<string[]> {
    return this.bySourceKey(sourceKey).map((d) => d.canonicalUrl)
  }

  // --- inspection (test helpers) -------------------------------------------

  all(): RawDocument[] {
    return [...this.rows.values()]
  }

  get(sourceKey: string, canonicalUrl: string): RawDocument | null {
    return this.rows.get(key(sourceKey, canonicalUrl)) ?? null
  }

  bySourceKey(sourceKey: string): RawDocument[] {
    return this.all().filter((d) => d.sourceKey === sourceKey)
  }

  count(): number {
    return this.rows.size
  }
}
