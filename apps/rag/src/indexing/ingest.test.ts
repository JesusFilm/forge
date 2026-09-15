/* eslint-disable max-lines -- indexing orchestration invariants are kept in one behavior suite */
/**
 * Indexing orchestrator tests — fakes only (no Postgres, no network). Drives
 * ingestPending over FakeRawDocumentReader + FakeEmbedder + FakeCorpusWriteStore,
 * using the real `starting-with-god` registry entry (pure data). Locks: source
 * upsert + document/chunk writes + ingested marking; the dedup gate (unchanged →
 * no rewrite); re-chunk on content change (delete-then-insert, no duplication);
 * the model-aware force gate (skip docs already on the target model, so an
 * interrupted re-embed resumes; forceAll overrides it); and the skip paths
 * (too-thin, unknown source).
 */
import { describe, expect, it } from "vitest"
import type {
  CorpusWriteStore,
  Embedder,
  EmbeddedChunk,
  NormalizedDocument,
  PendingRawDocument,
  SourceRecord,
} from "../contracts/index.js"
import {
  FakeCorpusWriteStore,
  FakeEmbedder,
  FakeRawDocumentReader,
} from "../fakes/index.js"
import { ingestPending, type IngestDeps } from "./index.js"

const KEY = "starting-with-god"

const body = (seed: string): string =>
  Array.from(
    { length: 30 },
    (_, i) =>
      `${seed} paragraph ${i}: knowing God, the gospel, and new life in Christ.`,
  ).join("\n\n")

function pending(
  overrides: Partial<PendingRawDocument> & Pick<PendingRawDocument, "id">,
): PendingRawDocument {
  const url =
    overrides.url ?? `https://www.startingwithgod.com/${overrides.id}.html`
  return {
    id: overrides.id,
    sourceKey: overrides.sourceKey ?? KEY,
    url,
    canonicalUrl: overrides.canonicalUrl ?? url,
    title: overrides.title ?? `Title ${overrides.id}`,
    rawContent: overrides.rawContent ?? body(overrides.id),
    fetch: {
      status: 200,
      bodyHash: `hash-${overrides.id}`,
      etag: null,
      lastModified: null,
      fetchedAt: new Date().toISOString(),
      notModified: false,
    },
  }
}

function deps(rows: PendingRawDocument[]): IngestDeps & {
  reader: FakeRawDocumentReader
  writer: FakeCorpusWriteStore
} {
  return {
    reader: new FakeRawDocumentReader(rows),
    embedder: new FakeEmbedder({ dimensions: 16 }),
    writer: new FakeCorpusWriteStore(),
  }
}

describe("ingestPending", () => {
  it("upserts the source, writes documents + chunks, and marks rows ingested", async () => {
    const d = deps([pending({ id: "a" }), pending({ id: "b" })])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({
      attempted: 2,
      inserted: 2,
      unchanged: 0,
      skipped: 0,
    })
    expect(summary.chunksWritten).toBeGreaterThan(0)
    expect(d.writer.allDocuments()).toHaveLength(2)
    expect(d.writer.getSource(KEY)).not.toBeNull()
    expect(d.reader.ingestedCount()).toBe(2)
    expect(d.reader.isIngested("a")).toBe(true)
  })

  it("dedups by content hash — a repeat of the same page writes no new chunks", async () => {
    const url = "https://www.startingwithgod.com/same.html"
    const content = body("same")
    // Same title + content + canonicalUrl ⇒ identical contentHash ⇒ dedup hit.
    const d = deps([
      pending({
        id: "first",
        url,
        canonicalUrl: url,
        title: "Same Page",
        rawContent: content,
      }),
      pending({
        id: "second",
        url,
        canonicalUrl: url,
        title: "Same Page",
        rawContent: content,
      }),
    ])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({ attempted: 2, inserted: 1, unchanged: 1 })
    expect(d.writer.allDocuments()).toHaveLength(1)
    const doc = d.writer.getDocument(KEY, url)!
    expect(d.writer.totalChunks()).toBe(doc.chunks.length) // no duplication
    expect(d.reader.ingestedCount()).toBe(2) // both consumed
  })

  it("re-chunks on content change — old chunks replaced, not accumulated", async () => {
    const url = "https://www.startingwithgod.com/evolving.html"
    const d = deps([
      pending({ id: "v1", url, canonicalUrl: url, rawContent: body("alpha") }),
      pending({
        id: "v2",
        url,
        canonicalUrl: url,
        rawContent: body("beta longer text"),
      }),
    ])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({
      attempted: 2,
      inserted: 1,
      updated: 1,
      unchanged: 0,
    })
    expect(d.writer.allDocuments()).toHaveLength(1)
    const doc = d.writer.getDocument(KEY, url)!
    expect(d.writer.totalChunks()).toBe(doc.chunks.length) // replaced, not summed
  })

  it("skips a too-thin doc but still marks it ingested", async () => {
    const d = deps([pending({ id: "thin", rawContent: "too short" })])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({ attempted: 1, inserted: 0, skipped: 1 })
    expect(d.writer.allDocuments()).toHaveLength(0)
    expect(d.reader.isIngested("thin")).toBe(true)
  })

  it("force re-drains ingested rows but SKIPS docs already on the target model", async () => {
    const d = deps([pending({ id: "a" }), pending({ id: "b" })])

    await ingestPending(d) // first pass marks both ingested (on the fake's model)
    const firstChunks = d.writer.totalChunks()
    expect(d.reader.ingestedCount()).toBe(2)

    // A plain re-run drains nothing (both already ingested).
    expect((await ingestPending(d)).attempted).toBe(0)

    // force re-drains the snapshot, but both docs are already on the target model
    // with unchanged content ⇒ re-embedding is a no-op ⇒ skipped. This model-aware
    // skip is what makes an interrupted --force resumable (see the next test).
    const forced = await ingestPending(d, { force: true })
    expect(forced).toMatchObject({ attempted: 2, updated: 0, unchanged: 2 })
    expect(d.writer.allDocuments()).toHaveLength(2)
    expect(d.writer.totalChunks()).toBe(firstChunks)
  })

  it("force re-embeds when the target model differs, then resumes idempotently", async () => {
    const rows = [pending({ id: "a" }), pending({ id: "b" })]
    const reader = new FakeRawDocumentReader(rows)
    const writer = new FakeCorpusWriteStore()
    const oldModel = new FakeEmbedder({
      dimensions: 16,
      model: "openai/text-embedding-3-small",
    })
    const newModel = new FakeEmbedder({
      dimensions: 16,
      model: "qwen/qwen3-embedding-8b",
    })
    const allOn = (m: string): boolean =>
      writer
        .allDocuments()
        .every((doc) => doc.chunks.every((c) => c.embeddingModel === m))

    // Initial ingest on the OLD model.
    await ingestPending({ reader, embedder: oldModel, writer })
    expect(allOn("openai/text-embedding-3-small")).toBe(true)

    // force with the NEW model re-embeds every doc (model differs ⇒ not skipped).
    const migrated = await ingestPending(
      { reader, embedder: newModel, writer },
      { force: true },
    )
    expect(migrated).toMatchObject({ attempted: 2, updated: 2, unchanged: 0 })
    expect(allOn("qwen/qwen3-embedding-8b")).toBe(true)

    // Re-running the SAME force now skips both — already migrated. The resume
    // property: an interrupted re-embed continues, it does not restart from zero.
    const resumed = await ingestPending(
      { reader, embedder: newModel, writer },
      { force: true },
    )
    expect(resumed).toMatchObject({ attempted: 2, updated: 0, unchanged: 2 })
  })

  it("forceAll re-embeds even documents already on the target model", async () => {
    const reader = new FakeRawDocumentReader([pending({ id: "a" })])
    const writer = new FakeCorpusWriteStore()
    const embedder = new FakeEmbedder({
      dimensions: 16,
      model: "qwen/qwen3-embedding-8b",
    })

    await ingestPending({ reader, embedder, writer })
    // Same model + unchanged content ⇒ force would skip; forceAll re-embeds
    // regardless — the escape hatch for a chunker change on the same model.
    const forced = await ingestPending(
      { reader, embedder, writer },
      { forceAll: true },
    )
    expect(forced).toMatchObject({ attempted: 1, updated: 1, unchanged: 0 })
  })

  it("skips an unknown source and leaves the row un-marked", async () => {
    const d = deps([pending({ id: "x", sourceKey: "no-such-source" })])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({
      attempted: 1,
      unknownSource: 1,
      inserted: 0,
    })
    expect(d.writer.allDocuments()).toHaveLength(0)
    expect(d.reader.isIngested("x")).toBe(false)
  })

  it("bounds concurrent documents and upserts the source before releasing workers", async () => {
    const reader = new FakeRawDocumentReader(
      Array.from({ length: 8 }, (_, i) => pending({ id: `concurrent-${i}` })),
    )
    const inner = new FakeCorpusWriteStore()
    let sourceReady = false
    let upserts = 0
    const writer: CorpusWriteStore = {
      async upsertSource(source: SourceRecord) {
        upserts++
        const id = await inner.upsertSource(source)
        sourceReady = true
        return id
      },
      getDedup: (sourceKey, canonicalUrl) =>
        inner.getDedup(sourceKey, canonicalUrl),
      replaceDocument: (doc, chunks) => {
        expect(sourceReady).toBe(true)
        return inner.replaceDocument(doc, chunks)
      },
    }
    let active = 0
    let peak = 0
    const fake = new FakeEmbedder({ dimensions: 16 })
    const embedder: Embedder = {
      model: fake.model,
      dimensions: fake.dimensions,
      embedQuery: (text) => fake.embedQuery(text),
      async embed(texts) {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        const result = await fake.embed(texts)
        active--
        return result
      },
    }

    await ingestPending({ reader, writer, embedder }, { concurrency: 3 })

    expect(peak).toBe(3)
    expect(upserts).toBe(1)
    expect(reader.ingestedCount()).toBe(8)
  })

  it("serializes duplicate canonical identities while processing distinct documents concurrently", async () => {
    const sameUrl = "https://www.startingwithgod.com/same-concurrent.html"
    const reader = new FakeRawDocumentReader([
      pending({
        id: "same-v1",
        canonicalUrl: sameUrl,
        url: sameUrl,
        rawContent: body("v1"),
      }),
      pending({ id: "other" }),
      pending({
        id: "same-v2",
        canonicalUrl: sameUrl,
        url: sameUrl,
        rawContent: body("v2"),
      }),
    ])
    const inner = new FakeCorpusWriteStore()
    const activeByDocument = new Set<string>()
    let distinctOverlap = false
    const writer: CorpusWriteStore = {
      upsertSource: (source) => inner.upsertSource(source),
      getDedup: (sourceKey, canonicalUrl) =>
        inner.getDedup(sourceKey, canonicalUrl),
      async replaceDocument(doc: NormalizedDocument, chunks: EmbeddedChunk[]) {
        expect(activeByDocument.has(doc.canonicalUrl)).toBe(false)
        activeByDocument.add(doc.canonicalUrl)
        distinctOverlap ||= activeByDocument.size > 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        await inner.replaceDocument(doc, chunks)
        activeByDocument.delete(doc.canonicalUrl)
      },
    }

    const summary = await ingestPending(
      { reader, writer, embedder: new FakeEmbedder({ dimensions: 16 }) },
      { concurrency: 3 },
    )

    expect(summary).toMatchObject({ attempted: 3, inserted: 2, updated: 1 })
    expect(distinctOverlap).toBe(true)
    expect(inner.getDocument(KEY, sameUrl)?.doc.content).toContain(
      "v2 paragraph",
    )
  })

  it("stops scheduling after a worker failure but drains already-running work", async () => {
    const reader = new FakeRawDocumentReader([
      pending({ id: "fail", rawContent: body("FAIL") }),
      pending({ id: "running" }),
      pending({ id: "not-started" }),
    ])
    const writer = new FakeCorpusWriteStore()
    const fake = new FakeEmbedder({ dimensions: 16 })
    const embedder: Embedder = {
      model: fake.model,
      dimensions: fake.dimensions,
      embedQuery: (text) => fake.embedQuery(text),
      async embed(texts) {
        if (texts.some((text) => text.includes("FAIL")))
          throw new Error("controlled failure")
        await new Promise((resolve) => setTimeout(resolve, 20))
        return fake.embed(texts)
      },
    }

    await expect(
      ingestPending({ reader, writer, embedder }, { concurrency: 2 }),
    ).rejects.toThrow("controlled failure")

    expect(reader.isIngested("fail")).toBe(false)
    expect(reader.isIngested("running")).toBe(true)
    expect(reader.isIngested("not-started")).toBe(false)
  })
})

describe("ingestPending language detection (#74)", () => {
  // Article-length Spanish prose split into paragraphs the chunker can work
  // with — flows through the real familylife entry (declares ["en", "es"]).
  const ES_BODY = [
    "La gracia de Dios es un regalo que nunca podríamos ganar por nuestra cuenta. El " +
      "evangelio invita a cada persona a confiar en Jesús y a apartarse del pecado.",
    "Cuando leemos las Escrituras descubrimos que el amor del Padre no depende de " +
      "nuestras obras ni de nuestros méritos, sino de su fidelidad eterna hacia nosotros.",
    "Por eso la fe cristiana no es una lista de reglas, sino una relación viva con el " +
      "Dios que nos creó, nos busca y nos llama por nombre cada día de nuestra vida.",
    "El perdón que Cristo ofrece renueva el corazón cansado y da esperanza verdadera a " +
      "toda persona que se acerca a él con humildad y con un corazón dispuesto a creer.",
  ].join("\n\n")
  const FR_BODY = [
    "La grâce de Dieu est un don que nous ne pourrions jamais mériter par nous-mêmes. " +
      "L'évangile invite chaque personne à faire confiance à Jésus de tout son cœur.",
    "Lorsque nous lisons les Écritures, nous découvrons que l'amour du Père ne dépend " +
      "pas de nos œuvres ni de nos mérites, mais de sa fidélité éternelle envers nous.",
    "C'est pourquoi la foi chrétienne n'est pas une liste de règles, mais une relation " +
      "vivante avec le Dieu qui nous a créés et qui nous appelle par notre propre nom.",
    "Le pardon que le Christ offre renouvelle le cœur fatigué et donne une espérance " +
      "véritable à toute personne qui s'approche de lui avec humilité et avec foi.",
  ].join("\n\n")

  it("labels a Spanish document es end-to-end (documents.language = 'es')", async () => {
    const url = "https://www.familylife.com/us-latinos/articulo"
    const d = deps([
      pending({
        id: "es-doc",
        sourceKey: "familylife",
        url,
        canonicalUrl: url,
        rawContent: ES_BODY,
      }),
    ])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({ attempted: 1, inserted: 1 })
    expect(d.writer.getDocument("familylife", url)!.doc.language).toBe("es")
  })

  it("stores an out-of-declared-set language and logs a ⚠ warning line", async () => {
    // starting-with-god declares ["en"]; confident French must be stored as fr
    // (content wins, ADR-0006) and the registry gap surfaced to the operator.
    const url = "https://www.startingwithgod.com/french-page.html"
    const d = deps([
      pending({ id: "fr-doc", url, canonicalUrl: url, rawContent: FR_BODY }),
    ])
    const lines: string[] = []

    await ingestPending(d, { onProgress: (line) => lines.push(line) })

    expect(d.writer.getDocument(KEY, url)!.doc.language).toBe("fr")
    expect(lines.some((l) => l.includes("⚠") && l.includes("'fr'"))).toBe(true)
  })

  it("stores language null below the detection floor (doc still ingested and chunked)", async () => {
    // 300 chars clears minContentLength (250) but not the detection floor (500).
    const url = "https://www.startingwithgod.com/thin-but-storable.html"
    const d = deps([
      pending({
        id: "short-doc",
        url,
        canonicalUrl: url,
        rawContent: ES_BODY.slice(0, 300),
      }),
    ])

    const summary = await ingestPending(d)

    expect(summary).toMatchObject({ attempted: 1, inserted: 1 })
    const stored = d.writer.getDocument(KEY, url)!
    expect(stored.doc.language).toBeNull()
    expect(stored.chunks.length).toBeGreaterThan(0)
  })
})
