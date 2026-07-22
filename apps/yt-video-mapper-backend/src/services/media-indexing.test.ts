import { describe, expect, it } from "vitest"
import {
  FetchOfficialMediaFetcher,
  InMemoryMediaIndexRepository,
  MediaIndexingSafeError,
  MediaIndexingService,
  type IndexableCatalogVariant,
  type InMemoryCatalogVariant,
  type MediaIndexRepository,
  type OfficialMediaFetchResult,
  type OfficialMediaFetcher,
} from "./media-indexing.js"
import type { OfficialMediaSignatureExtractor } from "./media-signature-extraction.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
  VISUAL_FRAME_FINGERPRINT_KIND,
} from "./visual-fingerprint.js"

const runStartedAt = new Date("2026-06-10T01:00:00.000Z")
const runFinishedAt = new Date("2026-06-10T01:01:00.000Z")

describe("MediaIndexingService", () => {
  it("selects only indexable catalog variants with media source URLs", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({
        id: "variant-a",
        mediaSourceUrl: "https://media/a.mp4?token=secret#fragment",
      }),
      variant({
        id: "variant-b",
        indexable: false,
        mediaSourceUrl: "https://media/b.mp4",
      }),
      variant({
        id: "variant-c",
        mediaSourceUrl: null,
      }),
    ])
    const fetcher = new StubOfficialMediaFetcher([mediaSample([1, 2, 3])])

    const result = await createService({ repository, fetcher }).indexCatalog()

    expect(fetcher.calls).toEqual([
      { url: "https://media/a.mp4?token=secret#fragment", maxBytes: 8 },
    ])
    expect(result).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-a",
      variantsAttempted: 1,
      variantsIndexed: 1,
      variantsFailed: 0,
      failureSummary: null,
    })
    expect(repository.signatures.size).toBe(1)
    expect([...repository.signatures.values()][0]?.sourceMediaUrl).toBe(
      "https://media/a.mp4",
    )
  })

  it("reruns the same algorithm version without duplicating signatures", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({ id: "variant-a" }),
    ])
    const fetcher = new StubOfficialMediaFetcher([mediaSample([1, 2, 3])])
    const service = createService({ repository, fetcher })

    await service.indexCatalog()
    const second = await service.indexCatalog()

    expect(fetcher.calls).toHaveLength(1)
    expect(repository.signatures.size).toBe(1)
    expect(second).toMatchObject({
      status: "completed",
      variantsAttempted: 1,
      variantsIndexed: 0,
      variantsFailed: 0,
    })
  })

  it("indexes the same variant again for v2 visual signatures", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({ id: "variant-a" }),
    ])
    const v2Extractor = visualExtractor()

    await createService({
      repository,
      fetcher: new StubOfficialMediaFetcher([mediaSample([1])]),
      algorithmVersion: "official-media-signature-v1",
    }).indexCatalog()
    await createService({
      repository,
      fetcher: new StubOfficialMediaFetcher([
        new Error("v2 should not fetch bytes"),
      ]),
      extractor: v2Extractor,
      algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    }).indexCatalog()

    expect(
      [...repository.signatures.values()].map((signature) => ({
        algorithmVersion: signature.algorithmVersion,
        signatureType: signature.signatureType,
      })),
    ).toEqual([
      {
        algorithmVersion: "official-media-signature-v1",
        signatureType: "STRUCTURAL_HINT",
      },
      {
        algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
        signatureType: "VISUAL_FRAME",
      },
    ])
    expect(v2Extractor.calls).toEqual([
      {
        sourceMediaUrl: "https://media.example.com/video.mp4",
        mediaSample: undefined,
      },
    ])
  })

  it("indexes v2 visual signatures from source URLs without byte-range fetching", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({ id: "variant-a" }),
    ])
    const fetcher = new StubOfficialMediaFetcher([
      new Error("fetch should not be called"),
    ])
    const extractor = visualExtractor()

    const result = await createService({
      repository,
      fetcher,
      extractor,
      algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    }).indexCatalog()

    expect(fetcher.calls).toEqual([])
    expect(result).toMatchObject({
      status: "completed",
      variantsAttempted: 1,
      variantsIndexed: 1,
      variantsFailed: 0,
    })
    expect([...repository.signatures.values()]).toEqual([
      expect.objectContaining({
        signatureType: "VISUAL_FRAME",
        algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
        sourceMediaUrl: "https://media.example.com/video.mp4",
        sourceMediaHash: null,
        signature: {
          kind: VISUAL_FRAME_FINGERPRINT_KIND,
          phash: "ffffffff00000000",
          frameWidth: 8,
          frameHeight: 8,
        },
      }),
    ])
  })

  it("records v2 extractor failures per variant without stopping the run", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({
        id: "variant-a",
        coreId: "core-a",
        videoVariantId: "dub-a",
        mediaSourceUrl: "https://media.example.com/private-a.mp4?token=secret",
      }),
      variant({
        id: "variant-b",
        coreId: "core-b",
        videoVariantId: "dub-b",
        mediaSourceUrl: "https://media.example.com/private-b.mp4",
      }),
    ])

    const result = await createService({
      repository,
      fetcher: new StubOfficialMediaFetcher([
        new Error("v2 should not fetch bytes"),
      ]),
      extractor: visualExtractor([
        new Error("ffmpeg failed for https://media.example.com/private-a.mp4"),
        "ffffffff00000000",
      ]),
      algorithmVersion: OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    }).indexCatalog()

    expect(result).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-b",
      variantsAttempted: 2,
      variantsIndexed: 1,
      variantsFailed: 1,
      failureSummary: {
        code: "variant_index_failures",
        failedCount: 1,
        failures: [
          {
            coreId: "core-a",
            videoVariantId: "dub-a",
            catalogVariantId: "variant-a",
            code: "variant_index_failed",
            message: "ffmpeg failed for [redacted-url]",
          },
        ],
      },
    })
    expect(repository.signatures.size).toBe(1)
  })

  it("records per-variant failures safely without stopping the run", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({
        id: "variant-a",
        coreId: "core-a",
        videoVariantId: "dub-a",
        mediaSourceUrl: "https://media.example.com/private-a.mp4?token=secret",
      }),
      variant({
        id: "variant-b",
        coreId: "core-b",
        videoVariantId: "dub-b",
        mediaSourceUrl: "https://media.example.com/private-b.mp4",
      }),
    ])
    const fetcher = new StubOfficialMediaFetcher([
      new Error(
        "download failed for https://media.example.com/private-a.mp4?token=secret",
      ),
      mediaSample([9, 9, 9]),
    ])

    const result = await createService({ repository, fetcher }).indexCatalog()

    expect(result).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-b",
      variantsAttempted: 2,
      variantsIndexed: 1,
      variantsFailed: 1,
      failureSummary: {
        code: "variant_index_failures",
        failedCount: 1,
        failures: [
          {
            coreId: "core-a",
            videoVariantId: "dub-a",
            catalogVariantId: "variant-a",
            code: "variant_index_failed",
            message: "download failed for [redacted-url]",
          },
        ],
      },
    })
    expect(JSON.stringify(result.failureSummary)).not.toContain("private-a.mp4")
    expect(repository.signatures.size).toBe(1)
  })

  it("counts empty extractor output as a per-variant failure", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({ id: "variant-a" }),
    ])

    const result = await createService({
      repository,
      fetcher: new StubOfficialMediaFetcher([mediaSample([1, 2, 3])]),
      extractor: {
        async extract() {
          return []
        },
      },
    }).indexCatalog()

    expect(result).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-a",
      variantsAttempted: 1,
      variantsIndexed: 0,
      variantsFailed: 1,
      failureSummary: {
        code: "variant_index_failures",
        failedCount: 1,
        failures: [
          {
            code: "no_signatures_generated",
            catalogVariantId: "variant-a",
          },
        ],
      },
    })
  })

  it("bounds failure summaries while preserving total failed count", async () => {
    const variants = Array.from({ length: 12 }, (_, index) =>
      variant({
        id: `variant-${String(index).padStart(2, "0")}`,
        coreId: `core-${index}`,
        videoVariantId: `dub-${index}`,
        mediaSourceUrl: `https://media.example.com/private-${index}.mp4?token=secret`,
      }),
    )
    const repository = new InMemoryMediaIndexRepository(variants)
    const fetcher = new StubOfficialMediaFetcher(
      variants.map(
        (_variant, index) =>
          new Error(
            `failed https://media.example.com/private-${index}.mp4?token=secret`,
          ),
      ),
    )

    const result = await createService({ repository, fetcher }).indexCatalog()

    expect(result).toMatchObject({
      status: "completed",
      variantsAttempted: 12,
      variantsIndexed: 0,
      variantsFailed: 12,
      failureSummary: {
        failedCount: 12,
        truncatedFailureCount: 2,
      },
    })
    expect(result.failureSummary?.failures).toHaveLength(10)
    expect(JSON.stringify(result.failureSummary)).not.toContain("token=secret")
  })

  it("stores run failure status when run state cannot continue", async () => {
    const repository = new FailingListMediaIndexRepository([
      variant({ id: "variant-a" }),
    ])

    const result = await createService({
      repository,
      fetcher: new StubOfficialMediaFetcher([]),
    }).indexCatalog()

    expect(result).toMatchObject({
      status: "failed",
      variantsAttempted: 0,
      variantsIndexed: 0,
      variantsFailed: 0,
      failureSummary: {
        code: "media_index_failed",
        message: "database unavailable",
      },
    })
  })

  it("resumes after the supplied cursor and advances by variant id", async () => {
    const repository = new InMemoryMediaIndexRepository([
      variant({ id: "variant-a" }),
      variant({ id: "variant-b" }),
      variant({ id: "variant-c" }),
    ])
    const fetcher = new StubOfficialMediaFetcher([mediaSample([3])])

    const result = await createService({
      repository,
      fetcher,
      pageSize: 1,
    }).indexCatalog({ resumeAfterVariantId: "variant-b" })

    expect(fetcher.calls).toEqual([
      { url: "https://media.example.com/video.mp4", maxBytes: 8 },
    ])
    expect(result).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-c",
      variantsAttempted: 1,
      variantsIndexed: 1,
    })
  })

  it("bounds page-local processing and checkpoints settled outcomes in input order", async () => {
    const repository = new TrackingMediaIndexRepository([
      variant({
        id: "variant-a",
        coreId: "core-a",
        mediaSourceUrl: "https://media.example.com/a.mp4",
      }),
      variant({
        id: "variant-b",
        coreId: "core-b",
        mediaSourceUrl: "https://media.example.com/b.mp4",
      }),
      variant({
        id: "variant-c",
        coreId: "core-c",
        mediaSourceUrl: "https://media.example.com/c.mp4",
      }),
      variant({
        id: "variant-d",
        coreId: "core-d",
        mediaSourceUrl: "https://media.example.com/d.mp4",
      }),
    ])
    const fetcher = new ControlledOfficialMediaFetcher()
    const indexing = createService({
      repository,
      fetcher,
      pageSize: 4,
      concurrency: 2,
    }).indexCatalog()

    await fetcher.waitForCalls(2)
    expect(fetcher.calls.map(({ url }) => url)).toEqual([
      "https://media.example.com/a.mp4",
      "https://media.example.com/b.mp4",
    ])
    expect(fetcher.maxInFlight).toBe(2)

    fetcher.complete("https://media.example.com/b.mp4", mediaSample([2]))
    await flushAsyncWork()

    expect(repository.checkpoints).toEqual([])
    expect(fetcher.calls).toHaveLength(2)

    fetcher.complete("https://media.example.com/a.mp4", mediaSample([1]))
    await fetcher.waitForCalls(4)

    expect(repository.checkpoints).toEqual([
      {
        cursorVariantId: "variant-b",
        variantsAttempted: 2,
        variantsIndexed: 2,
        variantsFailed: 0,
      },
    ])
    expect(fetcher.maxInFlight).toBe(2)

    fetcher.complete("https://media.example.com/d.mp4", mediaSample([4]))
    fetcher.fail(
      "https://media.example.com/c.mp4",
      new Error("media decode failed"),
    )

    const result = await indexing

    expect(result).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-d",
      variantsAttempted: 4,
      variantsIndexed: 3,
      variantsFailed: 1,
      failureSummary: {
        failedCount: 1,
        failures: [
          {
            catalogVariantId: "variant-c",
            code: "variant_index_failed",
            message: "media decode failed",
          },
        ],
      },
    })
    expect(repository.checkpoints).toEqual([
      {
        cursorVariantId: "variant-b",
        variantsAttempted: 2,
        variantsIndexed: 2,
        variantsFailed: 0,
      },
      {
        cursorVariantId: "variant-d",
        variantsAttempted: 4,
        variantsIndexed: 3,
        variantsFailed: 1,
      },
    ])
    expect(repository.signatures.size).toBe(3)
    expect(fetcher.inFlight).toBe(0)
  })

  it("replays a settled batch from the prior durable cursor after checkpoint failure", async () => {
    const variants = Array.from({ length: 8 }, (_, index) =>
      variant({
        id: `variant-${String(index).padStart(2, "0")}`,
        coreId: `core-${index}`,
        videoVariantId: `dub-${index}`,
        mediaSourceUrl: `https://media.example.com/${index}.mp4`,
      }),
    )
    const repository = new FailingCheckpointMediaIndexRepository(variants, 2)
    const fetcher = new StubOfficialMediaFetcher(
      variants.map((_variant, index) => mediaSample([index + 1])),
    )

    const failed = await createService({
      repository,
      fetcher,
      pageSize: 8,
      concurrency: 4,
    }).indexCatalog()

    expect(failed).toMatchObject({
      status: "failed",
      cursorVariantId: "variant-03",
      variantsAttempted: 4,
      variantsIndexed: 4,
      variantsFailed: 0,
      failureSummary: {
        code: "media_index_failed",
        message: "checkpoint unavailable",
        cursorVariantId: "variant-03",
      },
    })
    expect(repository.attemptedCheckpointCursors).toEqual([
      "variant-03",
      "variant-07",
    ])
    expect(repository.signatures.size).toBe(8)

    const replayed = await createService({
      repository,
      fetcher,
      pageSize: 8,
      concurrency: 4,
    }).indexCatalog({ resumeAfterVariantId: failed.cursorVariantId })

    expect(replayed).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-07",
      variantsAttempted: 4,
      variantsIndexed: 0,
      variantsFailed: 0,
    })
    expect(fetcher.calls).toHaveLength(8)
    expect(repository.signatures.size).toBe(8)
    expect(repository.attemptedCheckpointCursors).toEqual([
      "variant-03",
      "variant-07",
      "variant-07",
    ])
  })

  it("retains only durable failures and retries failures from an uncheckpointed batch", async () => {
    const variants = Array.from({ length: 8 }, (_, index) =>
      variant({
        id: `variant-${String(index).padStart(2, "0")}`,
        coreId: `core-${index}`,
        videoVariantId: `dub-${index}`,
        mediaSourceUrl: `https://media.example.com/${index}.mp4`,
      }),
    )
    const repository = new FailingCheckpointMediaIndexRepository(variants, 2)
    const fetcher = new StubOfficialMediaFetcher([
      mediaSample([1]),
      new Error("durable extraction failure"),
      mediaSample([3]),
      mediaSample([4]),
      mediaSample([5]),
      new Error("replayable extraction failure"),
      mediaSample([7]),
      mediaSample([8]),
      mediaSample([6]),
    ])

    const failed = await createService({
      repository,
      fetcher,
      pageSize: 8,
      concurrency: 4,
    }).indexCatalog()

    expect(failed).toMatchObject({
      status: "failed",
      cursorVariantId: "variant-03",
      variantsAttempted: 4,
      variantsIndexed: 3,
      variantsFailed: 1,
      failureSummary: {
        code: "media_index_failed",
        cursorVariantId: "variant-03",
        failedCount: 1,
        failures: [
          {
            catalogVariantId: "variant-01",
            message: "durable extraction failure",
          },
        ],
      },
    })
    expect(repository.signatures.size).toBe(6)

    const replayed = await createService({
      repository,
      fetcher,
      pageSize: 8,
      concurrency: 4,
    }).indexCatalog({ resumeAfterVariantId: failed.cursorVariantId })

    expect(replayed).toMatchObject({
      status: "completed",
      cursorVariantId: "variant-07",
      variantsAttempted: 4,
      variantsIndexed: 1,
      variantsFailed: 0,
      failureSummary: null,
    })
    expect(fetcher.calls).toHaveLength(9)
    expect(repository.signatures.size).toBe(7)
  })

  it("rejects programmatic concurrency above the safety limit", () => {
    expect(() =>
      createService({
        repository: new InMemoryMediaIndexRepository(),
        fetcher: new StubOfficialMediaFetcher([]),
        concurrency: 5,
      }),
    ).toThrow(
      new MediaIndexingSafeError(
        "invalid_media_index_concurrency",
        "Media index concurrency must be an integer between 1 and 4",
      ),
    )
  })
})

describe("FetchOfficialMediaFetcher", () => {
  it("requests bounded bytes and hashes the returned sample", async () => {
    const calls: Array<{
      url: string
      headers: Record<string, string>
      redirect?: "error"
      signal?: AbortSignal
    }> = []
    const fetcher = new FetchOfficialMediaFetcher(async (url, init) => {
      calls.push({
        url,
        headers: init.headers,
        redirect: init.redirect,
        signal: init.signal,
      })
      return {
        ok: true,
        status: 206,
        headers: {
          get(name: string) {
            return (
              new Map([
                ["content-type", "video/mp4"],
                ["content-length", "4"],
              ]).get(name) ?? null
            )
          },
        },
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3, 4]).buffer
        },
      }
    }, 5_000)

    const result = await fetcher.fetch({
      url: "https://media.example.com/video.mp4",
      maxBytes: 4,
    })

    expect(calls).toEqual([
      {
        url: "https://media.example.com/video.mp4",
        headers: { range: "bytes=0-3" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    ])
    expect(result).toMatchObject({
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "video/mp4",
      rangeStart: 0,
      rangeEnd: 3,
      complete: false,
      sourceMediaHash:
        "sha256:bytes=0-3:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    })
  })

  it("marks the source media hash as full only when content length proves it", async () => {
    const fetcher = new FetchOfficialMediaFetcher(async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name: string) {
          if (name === "content-length") return "4"
          if (name === "content-type") return "video/mp4"
          return null
        },
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]))
          controller.close()
        },
      }),
    }))

    const result = await fetcher.fetch({
      url: "https://media.example.com/video.mp4",
      maxBytes: 4,
    })

    expect(result.complete).toBe(true)
    expect(result.sourceMediaHash).toBe(
      "sha256:full:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    )
  })

  it("streams only up to the configured byte budget", async () => {
    let arrayBufferCalled = false
    let streamCanceled = false
    const fetcher = new FetchOfficialMediaFetcher(async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name: string) {
          return name === "content-length" ? "8" : null
        },
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]))
          controller.enqueue(new Uint8Array([5, 6, 7, 8]))
        },
        cancel() {
          streamCanceled = true
        },
      }),
      async arrayBuffer() {
        arrayBufferCalled = true
        return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer
      },
    }))

    const result = await fetcher.fetch({
      url: "https://media.example.com/video.mp4",
      maxBytes: 4,
    })

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(result.complete).toBe(false)
    expect(streamCanceled).toBe(true)
    expect(arrayBufferCalled).toBe(false)
  })

  it("rejects unsafe media URLs before issuing a request", async () => {
    const fetcher = new FetchOfficialMediaFetcher(async () => {
      throw new Error("fetch should not be called")
    }, 5_000)

    await expect(
      fetcher.fetch({
        url: "http://media.example.com/video.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_url_invalid_protocol",
    })
    await expect(
      fetcher.fetch({
        url: "https://localhost/video.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_url_private_host",
    })
    await expect(
      fetcher.fetch({
        url: "https://10.0.0.1/video.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_url_private_host",
    })
    await expect(
      fetcher.fetch({
        url: "https://[::ffff:127.0.0.1]/video.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_url_private_host",
    })
    await expect(
      fetcher.fetch({
        url: "https://[::ffff:10.0.0.1]/video.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_url_private_host",
    })
  })

  it("enforces the optional official media host allowlist", async () => {
    const fetcher = new FetchOfficialMediaFetcher(
      async () => {
        throw new Error("fetch should not be called")
      },
      5_000,
      new Set(["media.example.com"]),
    )

    await expect(
      fetcher.fetch({
        url: "https://other.example.com/video.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_url_host_not_allowed",
    })
  })

  it("treats empty media responses as safe fetch failures", async () => {
    const fetcher = new FetchOfficialMediaFetcher(async () => ({
      ok: true,
      status: 204,
      headers: {
        get() {
          return null
        },
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
    }))

    await expect(
      fetcher.fetch({
        url: "https://media.example.com/empty.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "media_fetch_empty",
    })
  })

  it("normalizes HTTP failures into safe indexer errors", async () => {
    const fetcher = new FetchOfficialMediaFetcher(async () => ({
      ok: false,
      status: 403,
      async arrayBuffer() {
        return new ArrayBuffer(0)
      },
    }))

    await expect(
      fetcher.fetch({
        url: "https://media.example.com/private.mp4",
        maxBytes: 4,
      }),
    ).rejects.toMatchObject(
      new MediaIndexingSafeError(
        "media_fetch_http_error",
        "Official media request failed with status 403",
      ),
    )
  })
})

function createService({
  repository,
  fetcher,
  extractor,
  algorithmVersion = "official-media-signature-v1",
  pageSize = 10,
  concurrency,
}: {
  repository: MediaIndexRepository
  fetcher: OfficialMediaFetcher
  extractor?: OfficialMediaSignatureExtractor
  algorithmVersion?: string
  pageSize?: number
  concurrency?: number
}) {
  const dates = [runStartedAt, runFinishedAt]
  return new MediaIndexingService({
    repository,
    fetcher,
    extractor,
    algorithmVersion,
    pageSize,
    concurrency,
    maxMediaBytes: 8,
    now: () => dates.shift() ?? runFinishedAt,
  })
}

class StubOfficialMediaFetcher implements OfficialMediaFetcher {
  readonly calls: Array<{ url: string; maxBytes: number }> = []

  constructor(
    private readonly results: Array<OfficialMediaFetchResult | Error>,
  ) {}

  async fetch(input: {
    url: string
    maxBytes: number
  }): Promise<OfficialMediaFetchResult> {
    this.calls.push(input)
    const result = this.results.shift()
    if (!result) throw new Error("No stub media fetch configured")
    if (result instanceof Error) throw result
    return result
  }
}

class FailingListMediaIndexRepository extends InMemoryMediaIndexRepository {
  override async listIndexableVariants(): Promise<IndexableCatalogVariant[]> {
    throw new Error("database unavailable")
  }
}

class TrackingMediaIndexRepository extends InMemoryMediaIndexRepository {
  readonly checkpoints: Array<{
    cursorVariantId: string
    variantsAttempted: number
    variantsIndexed: number
    variantsFailed: number
  }> = []

  override async updateIndexRun(
    id: string,
    patch: Parameters<MediaIndexRepository["updateIndexRun"]>[1],
  ) {
    if (patch.status === undefined && patch.cursorVariantId) {
      this.checkpoints.push({
        cursorVariantId: patch.cursorVariantId,
        variantsAttempted: patch.variantsAttempted!,
        variantsIndexed: patch.variantsIndexed!,
        variantsFailed: patch.variantsFailed!,
      })
    }
    return super.updateIndexRun(id, patch)
  }
}

class FailingCheckpointMediaIndexRepository extends InMemoryMediaIndexRepository {
  readonly attemptedCheckpointCursors: string[] = []
  private checkpointNumber = 0

  constructor(
    variants: InMemoryCatalogVariant[],
    private readonly failingCheckpointNumber: number,
  ) {
    super(variants)
  }

  override async updateIndexRun(
    id: string,
    patch: Parameters<MediaIndexRepository["updateIndexRun"]>[1],
  ) {
    if (patch.status === undefined && patch.cursorVariantId) {
      this.checkpointNumber += 1
      this.attemptedCheckpointCursors.push(patch.cursorVariantId)
      if (this.checkpointNumber === this.failingCheckpointNumber) {
        throw new Error("checkpoint unavailable")
      }
    }
    return super.updateIndexRun(id, patch)
  }
}

class ControlledOfficialMediaFetcher implements OfficialMediaFetcher {
  readonly calls: Array<{ url: string; maxBytes: number }> = []
  inFlight = 0
  maxInFlight = 0
  private readonly pending = new Map<
    string,
    {
      resolve: (sample: OfficialMediaFetchResult) => void
      reject: (error: Error) => void
    }
  >()
  private readonly callWaiters: Array<{
    count: number
    resolve: () => void
  }> = []

  async fetch(input: {
    url: string
    maxBytes: number
  }): Promise<OfficialMediaFetchResult> {
    this.calls.push(input)
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)

    const sample = new Promise<OfficialMediaFetchResult>((resolve, reject) => {
      this.pending.set(input.url, { resolve, reject })
    })
    this.resolveCallWaiters()

    try {
      return await sample
    } finally {
      this.inFlight -= 1
      this.pending.delete(input.url)
    }
  }

  async waitForCalls(count: number): Promise<void> {
    if (this.calls.length >= count) return
    await new Promise<void>((resolve) => {
      this.callWaiters.push({ count, resolve })
    })
  }

  complete(url: string, sample: OfficialMediaFetchResult): void {
    const pending = this.pending.get(url)
    if (!pending) throw new Error(`No pending fetch for ${url}`)
    pending.resolve(sample)
  }

  fail(url: string, error: Error): void {
    const pending = this.pending.get(url)
    if (!pending) throw new Error(`No pending fetch for ${url}`)
    pending.reject(error)
  }

  private resolveCallWaiters(): void {
    for (const waiter of this.callWaiters.splice(0)) {
      if (this.calls.length >= waiter.count) {
        waiter.resolve()
      } else {
        this.callWaiters.push(waiter)
      }
    }
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function mediaSample(bytes: number[]): OfficialMediaFetchResult {
  return {
    bytes: new Uint8Array(bytes),
    sourceMediaHash: `sha256:sample:${bytes.join("-")}`,
    rangeStart: 0,
    rangeEnd: bytes.length - 1,
    complete: true,
  }
}

function visualExtractor(
  results: Array<string | Error> = ["ffffffff00000000"],
): OfficialMediaSignatureExtractor & {
  calls: Array<{
    sourceMediaUrl: string | undefined
    mediaSample: unknown
  }>
} {
  const calls: Array<{
    sourceMediaUrl: string | undefined
    mediaSample: unknown
  }> = []

  return {
    calls,
    async extract(input) {
      calls.push({
        sourceMediaUrl: input.sourceMediaUrl,
        mediaSample: input.mediaSample,
      })
      const result = results.shift()
      if (!result) throw new Error("No visual extractor result configured")
      if (result instanceof Error) throw result

      return [
        {
          coreId: input.variant.coreId,
          videoVariantId: input.variant.videoVariantId,
          signatureType: "VISUAL_FRAME",
          algorithmVersion:
            input.algorithmVersion ??
            OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
          offsetMilliseconds: 0,
          durationMilliseconds: null,
          signature: {
            kind: VISUAL_FRAME_FINGERPRINT_KIND,
            phash: result,
            frameWidth: 8,
            frameHeight: 8,
          },
          sourceMediaHash: null,
        },
      ]
    },
  }
}

function variant(
  overrides: Partial<InMemoryCatalogVariant> = {},
): InMemoryCatalogVariant {
  return {
    id: "variant-a",
    coreId: "core-video-1",
    videoVariantId: "variant-en",
    mediaSourceType: "DOWNLOAD",
    mediaSourceUrl: "https://media.example.com/video.mp4",
    indexable: true,
    durationSeconds: 120,
    lengthInMilliseconds: null,
    downloadQuality: "1080p",
    downloadWidth: 1920,
    downloadHeight: 1080,
    languageSlug: "english",
    locale: "en",
    editionName: "Feature",
    ...overrides,
  }
}
