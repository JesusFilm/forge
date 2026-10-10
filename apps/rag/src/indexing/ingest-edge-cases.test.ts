import { describe, expect, it } from "vitest"
import type { Embedder, PendingRawDocument } from "../contracts/index.js"
import {
  FakeCorpusWriteStore,
  FakeEmbedder,
  FakeRawDocumentReader,
} from "../fakes/index.js"
import { ingestPending } from "./index.js"

const pending = (id: string): PendingRawDocument => ({
  id,
  sourceKey: "starting-with-god",
  url: `https://www.startingwithgod.com/${id}.html`,
  canonicalUrl: `https://www.startingwithgod.com/${id}.html`,
  title: id,
  rawContent: Array.from(
    { length: 30 },
    (_, index) =>
      `${id} paragraph ${index}: knowing God and new life in Christ.`,
  ).join("\n\n"),
  fetch: {
    status: 200,
    bodyHash: id,
    etag: null,
    lastModified: null,
    fetchedAt: "2026-08-07T00:00:00.000Z",
    notModified: false,
  },
})

describe("ingestPending concurrency edge cases", () => {
  it("records a rejection even when a port rejects with undefined", async () => {
    const reader = new FakeRawDocumentReader([
      pending("undefined-failure"),
      pending("must-not-start"),
    ])
    const fake = new FakeEmbedder({ dimensions: 16 })
    const embedder: Embedder = {
      model: fake.model,
      dimensions: fake.dimensions,
      embedQuery: (text) => fake.embedQuery(text),
      embed: () => Promise.reject(undefined),
    }

    await expect(
      ingestPending({ reader, writer: new FakeCorpusWriteStore(), embedder }),
    ).rejects.toBeUndefined()
    expect(reader.ingestedCount()).toBe(0)
  })

  it("rejects concurrency above the operational cap", async () => {
    const reader = new FakeRawDocumentReader([pending("capped")])
    await expect(
      ingestPending(
        {
          reader,
          writer: new FakeCorpusWriteStore(),
          embedder: new FakeEmbedder({ dimensions: 16 }),
        },
        { concurrency: 5 },
      ),
    ).rejects.toThrow(/safe integer from 1 to 4/)
    expect(reader.ingestedCount()).toBe(0)
  })
})
