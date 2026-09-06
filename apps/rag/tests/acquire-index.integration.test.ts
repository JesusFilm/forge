import { describe, expect, it } from "vitest"

import { acquireSource } from "../src/acquisition/index.js"
import {
  FakeCorpusWriteStore,
  FakeEmbedder,
  FakeFetcher,
  FakeRawDocumentReader,
  FakeRawDocumentStore,
} from "../src/fakes/index.js"
import { ingestPending } from "../src/indexing/index.js"
import { getSource } from "../src/registry/index.js"

describe("acquire to index integration", () => {
  it("stages, indexes with model provenance, and reruns idempotently", async () => {
    const registered = getSource("starting-with-god")!
    const path = "/fixture.html"
    const url = `${registered.crawl.baseUrl}${path}`
    const source = {
      ...registered,
      crawl: { ...registered.crawl, seedPaths: [path], requestDelayMs: 0 },
    }
    const prose = Array.from(
      { length: 24 },
      (_, index) =>
        `Paragraph ${index} explains knowing God, grace, faith, and new life in Christ.`,
    ).join(" ")
    const fetcher = new FakeFetcher({
      [url]: {
        status: 200,
        body: `<html><head><title>Fixture</title></head><body><main id="content">${prose}</main></body></html>`,
        etag: '"fixture-v1"',
        lastModified: null,
        notModified: false,
      },
    })
    const staging = new FakeRawDocumentStore()
    const writer = new FakeCorpusWriteStore()
    const embedder = new FakeEmbedder({
      model: "fixture/model-v1",
      dimensions: 16,
    })

    expect(
      await acquireSource({ fetcher, store: staging }, source),
    ).toMatchObject({ written: 1 })
    expect(staging.count()).toBe(1)

    const indexStaging = async () => {
      const reader = new FakeRawDocumentReader(
        staging.all().map((raw, index) => ({ ...raw, id: `raw-${index}` })),
      )
      return ingestPending({ reader, embedder, writer })
    }

    expect(await indexStaging()).toMatchObject({ inserted: 1, unchanged: 0 })
    const stored = writer.getDocument(source.key, url)!
    expect(stored.chunks.length).toBeGreaterThan(0)
    expect(
      stored.chunks.every(
        (chunk) => chunk.embeddingModel === "fixture/model-v1",
      ),
    ).toBe(true)

    expect(
      await acquireSource({ fetcher, store: staging }, source),
    ).toMatchObject({ written: 1 })
    expect(staging.count()).toBe(1)
    expect(await indexStaging()).toMatchObject({ inserted: 0, unchanged: 1 })
    expect(writer.allDocuments()).toHaveLength(1)
    expect(writer.totalChunks()).toBe(stored.chunks.length)
  })
})
