import { describe, expect, it } from "vitest"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "./content-embedding-contract"
import {
  auditWatchSearchTranscriptCorpus,
  type ReconciliationPrisma,
  type ReconciliationTypesense,
} from "./typesense-watch-search-transcript-reconciliation"
import { canonicalTypesenseVideoId } from "./typesense-watch-search-identifiers"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"

const CONTRACT_ID = ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.id
const CHUNKING_VERSION = "mastra-v1"
const TRANSCRIPT_COLLECTION = "watch_search_transcripts_v1"

function embeddingVector(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, index) => {
    if (index === 0) return seed
    if (index === 1) return seed / 2
    return 0
  })
}

function embeddingText(seed: number): string {
  return `[${embeddingVector(seed).join(",")}]`
}

type Chunk = {
  chunkId: string
  coreId: string | null
  publiclyVisible: boolean
  text: string
  startSeconds: number | null
  embeddingSeed: number
}

type Transcript = {
  transcriptId: string
  videoId: string
  videoEditionId: string
  language: string
  sourceGeneration: bigint
  sourceContentHash: string | null
  chunks: Chunk[]
}

type Event = {
  id: string
  transcriptId: string
  status: "PENDING" | "CLAIMED" | "COMPLETED" | "DEAD_LETTER"
  sourceGeneration: bigint
  currentDocumentIds: string[]
  staleDocumentIds: string[]
}

type TypesenseDocument = {
  id: string
  documentKind: "transcript"
  videoId: string
  videoEditionId: string
  canonicalVideoId: string
  language: string
  publiclyVisible: boolean
  text: string
  startSeconds: number | null
  embedding: number[]
}

function sqlText(query: unknown): string {
  if (query && typeof query === "object" && "sql" in (query as object)) {
    return (query as { sql: string }).sql
  }
  return String(query)
}

function sqlValues(query: unknown): unknown[] {
  if (query && typeof query === "object" && "values" in (query as object)) {
    return (query as { values: unknown[] }).values
  }
  return []
}

function buildFixture(input: {
  transcripts: Transcript[]
  events?: Event[]
  typesenseDocuments: TypesenseDocument[]
  projection?: {
    transcriptCollection: string
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
    projectionRevision: bigint
  } | null
}) {
  const state = {
    transcripts: input.transcripts,
    events: input.events ?? [],
    typesenseDocuments: new Map(
      input.typesenseDocuments.map((doc) => [doc.id, doc]),
    ),
    projection: input.projection ?? null,
    nextEventSeq: 1,
  }

  const prisma = {
    $queryRaw: async (query: unknown) => {
      const text = sqlText(query)
      const values = sqlValues(query)

      if (text.includes("content_embedding_contract_pointer pointer")) {
        return [
          {
            pointerId: CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
            contractId: CONTRACT_ID,
            queryProvider:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.provider,
            queryModel: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.model,
            queryNativeDimensions:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.nativeDimensions,
            queryDimensions:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.dimensions,
            queryTransformVersion:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.transformVersion,
            storageProvider:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.provider,
            storageModel: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.model,
            storageNativeDimensions:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.nativeDimensions,
            storageDimensions:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.dimensions,
            storageTransformVersion:
              ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.transformVersion,
          },
        ]
      }

      if (text.includes("SELECT DISTINCT vt.chunking_version")) {
        return [{ chunkingVersion: CHUNKING_VERSION }]
      }

      if (text.includes("FROM video_transcript_chunk vtc")) {
        return state.transcripts.flatMap((transcript) =>
          transcript.chunks.map((chunk) => ({
            transcriptId: transcript.transcriptId,
            videoId: transcript.videoId,
            videoEditionId: transcript.videoEditionId,
            language: transcript.language,
            sourceGeneration: transcript.sourceGeneration,
            sourceContentHash: transcript.sourceContentHash,
            chunkId: chunk.chunkId,
            coreId: chunk.coreId,
            publiclyVisible: chunk.publiclyVisible,
            text: chunk.text,
            startSeconds: chunk.startSeconds,
            embeddingText: embeddingText(chunk.embeddingSeed),
          })),
        )
      }

      if (text.trim().endsWith("WHERE id = ?")) {
        const transcriptId = values[0] as string
        const transcript = state.transcripts.find(
          (candidate) => candidate.transcriptId === transcriptId,
        )
        return transcript
          ? [
              {
                sourceGeneration: transcript.sourceGeneration,
                sourceContentHash: transcript.sourceContentHash,
              },
            ]
          : []
      }

      if (text.includes('SELECT id, transcript_id AS "transcriptId"')) {
        const ids = values as string[]
        return state.transcripts.flatMap((transcript) =>
          transcript.chunks
            .filter((chunk) => ids.includes(chunk.chunkId))
            .map((chunk) => ({
              id: chunk.chunkId,
              transcriptId: transcript.transcriptId,
            })),
        )
      }

      if (text.includes("CROSS JOIN LATERAL unnest(")) {
        const ids = values as string[]
        const owners: Array<{ documentId: string; transcriptId: string }> = []
        for (const event of state.events) {
          for (const documentId of [
            ...event.currentDocumentIds,
            ...event.staleDocumentIds,
          ]) {
            if (ids.includes(documentId)) {
              owners.push({ documentId, transcriptId: event.transcriptId })
            }
          }
        }
        return owners
      }

      throw new Error(`Unexpected $queryRaw in test fixture: ${text}`)
    },
    watchSearchCurrentTranscriptProjection: {
      findUnique: async () =>
        state.projection ? { ...state.projection } : null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        state.projection = {
          transcriptCollection: create.transcriptCollection as string,
          contentEmbeddingContractId:
            create.contentEmbeddingContractId as string,
          transcriptChunkingVersion: create.transcriptChunkingVersion as string,
          projectionRevision: create.projectionRevision as bigint,
        }
        return { ...state.projection }
      },
    },
    watchSearchCurrentTranscriptPublicationEvent: {
      findMany: async () =>
        state.events
          .filter((event) => event.status !== "COMPLETED")
          .map((event) => ({
            id: event.id,
            transcriptId: event.transcriptId,
            status: event.status,
            sourceGeneration: event.sourceGeneration,
          })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } }
        data: { status: Event["status"] }
      }) => {
        let count = 0
        for (const event of state.events) {
          if (where.id.in.includes(event.id)) {
            event.status = data.status
            count += 1
          }
        }
        return { count }
      },
      create: async ({
        data,
      }: {
        data: {
          transcriptId: string
          currentDocumentIds: string[]
          staleDocumentIds: string[]
          sourceGeneration: bigint
        }
      }) => {
        const duplicate = state.events.some(
          (event) =>
            event.transcriptId === data.transcriptId &&
            event.sourceGeneration === data.sourceGeneration,
        )
        if (duplicate) {
          const error = Object.assign(new Error("unique constraint"), {
            code: "P2002",
          })
          throw error
        }
        const event: Event = {
          id: `event-${state.nextEventSeq++}`,
          transcriptId: data.transcriptId,
          status: "PENDING",
          sourceGeneration: data.sourceGeneration,
          currentDocumentIds: data.currentDocumentIds,
          staleDocumentIds: data.staleDocumentIds,
        }
        state.events.push(event)
        return event
      },
    },
  }

  const typesense = {
    getAlias: async (alias: string) => {
      const physical: Record<string, string> = {
        [TYPESENSE_WATCH_CATALOG_ALIAS]: "watch_search_catalog_v1",
        [TYPESENSE_WATCH_AVAILABILITY_ALIAS]: "watch_search_availability_v1",
        [TYPESENSE_WATCH_LEXICAL_ALIAS]: "watch_search_lexical_v1",
        [TYPESENSE_WATCH_TRANSCRIPT_ALIAS]: TRANSCRIPT_COLLECTION,
      }
      return { name: alias, collection_name: physical[alias]! }
    },
    getDocument: async (_collection: string, id: string) => {
      return state.typesenseDocuments.get(id)
    },
    exportDocuments: async () => {
      return [...state.typesenseDocuments.values()].map((doc) => ({
        id: doc.id,
      }))
    },
  }

  return {
    state,
    prisma: prisma as unknown as ReconciliationPrisma,
    typesense: typesense as unknown as ReconciliationTypesense,
  }
}

function canonicalDocument(
  transcript: Transcript,
  chunk: Chunk,
): TypesenseDocument {
  return {
    id: chunk.chunkId,
    documentKind: "transcript",
    videoId: transcript.videoId,
    videoEditionId: transcript.videoEditionId,
    canonicalVideoId: canonicalTypesenseVideoId(
      transcript.videoId,
      chunk.coreId,
    ),
    language: transcript.language,
    publiclyVisible: chunk.publiclyVisible,
    text: chunk.text,
    startSeconds: chunk.startSeconds,
    embedding: embeddingVector(chunk.embeddingSeed),
  }
}

describe("auditWatchSearchTranscriptCorpus", () => {
  it("dry-run reports an exact match without mutating anything", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-1",
      videoId: "video-1",
      videoEditionId: "edition-1",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-1",
      chunks: [
        {
          chunkId: "chunk-1",
          coreId: "core-1",
          publiclyVisible: true,
          text: "hello",
          startSeconds: 0,
          embeddingSeed: 1,
        },
      ],
    }
    const existingEvent: Event = {
      id: "event-1",
      transcriptId: "transcript-1",
      status: "PENDING",
      sourceGeneration: 1n,
      currentDocumentIds: ["chunk-1"],
      staleDocumentIds: [],
    }
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      events: [existingEvent],
      typesenseDocuments: [
        canonicalDocument(transcript, transcript.chunks[0]!),
      ],
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: true,
      now: new Date("2026-10-22T00:00:00.000Z"),
    })

    expect(report.dryRun).toBe(true)
    expect(report.exactMatchTranscriptIds).toEqual(["transcript-1"])
    expect(report.seededTranscriptIds).toEqual([])
    expect(report.embeddingDriftTranscriptIds).toEqual([])
    expect(state.events[0]!.status).toBe("PENDING")
  })

  it("seeds the ledger for an exact match without importing anything into Typesense", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-1",
      videoId: "video-1",
      videoEditionId: "edition-1",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-1",
      chunks: [
        {
          chunkId: "chunk-1",
          coreId: "core-1",
          publiclyVisible: true,
          text: "hello",
          startSeconds: 0,
          embeddingSeed: 1,
        },
      ],
    }
    const existingEvent: Event = {
      id: "event-1",
      transcriptId: "transcript-1",
      status: "PENDING",
      sourceGeneration: 1n,
      currentDocumentIds: ["chunk-1"],
      staleDocumentIds: [],
    }
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      events: [existingEvent],
      typesenseDocuments: [
        canonicalDocument(transcript, transcript.chunks[0]!),
      ],
      projection: null,
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
      now: new Date("2026-10-22T00:00:00.000Z"),
    })

    expect(report.exactMatchTranscriptIds).toEqual(["transcript-1"])
    expect(report.seededTranscriptIds).toEqual(["transcript-1"])
    expect(state.events[0]!.status).toBe("COMPLETED")
    // The projection was bootstrapped because nothing had verified the
    // collection before, but establishing it never calls a Typesense write
    // method — the fixture's `typesense` object has no import/upsert at all.
    expect(state.projection).not.toBeNull()
    expect(state.projection!.transcriptCollection).toBe(TRANSCRIPT_COLLECTION)
  })

  it("enqueues a publication event through the normal path for a transcript missing from Typesense", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-2",
      videoId: "video-2",
      videoEditionId: "edition-2",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-2",
      chunks: [
        {
          chunkId: "chunk-2a",
          coreId: "core-2",
          publiclyVisible: true,
          text: "never published",
          startSeconds: 0,
          embeddingSeed: 2,
        },
      ],
    }
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      typesenseDocuments: [],
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.embeddingDriftTranscriptIds).toEqual(["transcript-2"])
    expect(report.enqueuedPublicationTranscriptIds).toEqual(["transcript-2"])
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({
      transcriptId: "transcript-2",
      status: "PENDING",
      currentDocumentIds: ["chunk-2a"],
      staleDocumentIds: [],
    })
  })

  it("does not duplicate an already-represented transcript's outbox work", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-3",
      videoId: "video-3",
      videoEditionId: "edition-3",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-3",
      chunks: [
        {
          chunkId: "chunk-3a",
          coreId: "core-3",
          publiclyVisible: true,
          text: "missing",
          startSeconds: 0,
          embeddingSeed: 3,
        },
      ],
    }
    const existingEvent: Event = {
      id: "event-existing",
      transcriptId: "transcript-3",
      status: "PENDING",
      sourceGeneration: 1n,
      currentDocumentIds: ["chunk-3a"],
      staleDocumentIds: [],
    }
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      events: [existingEvent],
      typesenseDocuments: [],
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.embeddingDriftTranscriptIds).toEqual(["transcript-3"])
    expect(report.alreadyRepresentedTranscriptIds).toEqual(["transcript-3"])
    expect(report.enqueuedPublicationTranscriptIds).toEqual([])
    expect(state.events).toHaveLength(1)
  })

  it("reports vector-only drift on an otherwise matching document set", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-4",
      videoId: "video-4",
      videoEditionId: "edition-4",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-4",
      chunks: [
        {
          chunkId: "chunk-4a",
          coreId: "core-4",
          publiclyVisible: true,
          text: "same text",
          startSeconds: 0,
          embeddingSeed: 4,
        },
      ],
    }
    const stale = canonicalDocument(transcript, transcript.chunks[0]!)
    stale.embedding = embeddingVector(999)
    const { report } = await (async () => {
      const { prisma, typesense } = buildFixture({
        transcripts: [transcript],
        typesenseDocuments: [stale],
      })
      return {
        report: await auditWatchSearchTranscriptCorpus({
          prisma,
          typesense,
          dryRun: true,
        }),
      }
    })()

    expect(report.embeddingDriftTranscriptIds).toEqual(["transcript-4"])
    expect(report.exactMatchTranscriptIds).toEqual([])
    expect(report.visibilityOnlyDriftTranscriptIds).toEqual([])
  })

  it("reports lifecycle-only visibility drift without enqueueing anything", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-5",
      videoId: "video-5",
      videoEditionId: "edition-5",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-5",
      chunks: [
        {
          chunkId: "chunk-5a",
          coreId: "core-5",
          publiclyVisible: false,
          text: "unlisted now",
          startSeconds: 0,
          embeddingSeed: 5,
        },
      ],
    }
    const stale = canonicalDocument(transcript, transcript.chunks[0]!)
    stale.publiclyVisible = true
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      typesenseDocuments: [stale],
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.visibilityOnlyDriftTranscriptIds).toEqual(["transcript-5"])
    expect(report.embeddingDriftTranscriptIds).toEqual([])
    expect(report.enqueuedPublicationTranscriptIds).toEqual([])
    expect(report.seededTranscriptIds).toEqual([])
    expect(state.events).toHaveLength(0)
  })

  it("folds a proven extra document into its still-live owning transcript's repair event", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-6",
      videoId: "video-6",
      videoEditionId: "edition-6",
      language: "en",
      sourceGeneration: 2n,
      sourceContentHash: "hash-6",
      chunks: [
        {
          chunkId: "chunk-6b",
          coreId: "core-6",
          publiclyVisible: true,
          text: "current chunk",
          startSeconds: 0,
          embeddingSeed: 6,
        },
      ],
    }
    // chunk-6a is leftover Typesense evidence from a prior, smaller chunking
    // of the SAME still-existing transcript. It's gone from canonical
    // chunk rows but still resolvable as this transcript's own leftover.
    const leftover: TypesenseDocument = {
      id: "chunk-6a-stale",
      documentKind: "transcript",
      videoId: transcript.videoId,
      videoEditionId: transcript.videoEditionId,
      canonicalVideoId: "core-6",
      language: "en",
      publiclyVisible: true,
      text: "old chunk",
      startSeconds: 0,
      embedding: embeddingVector(60),
    }
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      typesenseDocuments: [
        canonicalDocument(transcript, transcript.chunks[0]!),
        leftover,
      ],
    })
    // The lookup for proven ownership resolves via video_transcript_chunk —
    // simulate that chunk-6a-stale still exists as a Postgres row owned by
    // the SAME transcript by injecting it into the canonical chunk table
    // fixture used for the ownership query (not the current chunk set).
    state.transcripts[0]!.chunks.push({
      chunkId: "chunk-6a-stale",
      coreId: "core-6",
      publiclyVisible: true,
      text: "old chunk",
      startSeconds: 0,
      embeddingSeed: 60,
    })
    // Remove it again from the CURRENT canonical set used for the main
    // enumeration query by overriding the fixture's canonical chunk list
    // consumed specifically for ownership resolution: the fixture's
    // `video_transcript_chunk` based ownership query reads from
    // `state.transcripts`, so this single list serves both purposes in the
    // fixture. To keep "current" vs "ownership" distinct like production
    // (two different tables), re-run with the extra chunk excluded from the
    // canonical enumeration result by filtering it out at query time.
    const originalQueryRaw = prisma.$queryRaw
    prisma.$queryRaw = (async (query: unknown) => {
      const text = sqlText(query)
      const rows = await (originalQueryRaw as (q: unknown) => Promise<unknown>)(
        query,
      )
      if (text.includes("FROM video_transcript_chunk vtc")) {
        return (rows as Array<{ chunkId: string }>).filter(
          (row) => row.chunkId !== "chunk-6a-stale",
        )
      }
      return rows
    }) as unknown as ReconciliationPrisma["$queryRaw"]

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.embeddingDriftTranscriptIds).toEqual(["transcript-6"])
    expect(report.enqueuedPublicationTranscriptIds).toEqual(["transcript-6"])
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({
      transcriptId: "transcript-6",
      currentDocumentIds: ["chunk-6b"],
      staleDocumentIds: ["chunk-6a-stale"],
    })
  })

  it("reports an orphan whose owning transcript was deleted as lifecycle-owned, never enqueuing it", async () => {
    const orphan: TypesenseDocument = {
      id: "chunk-ghost",
      documentKind: "transcript",
      videoId: "video-ghost",
      videoEditionId: "edition-ghost",
      canonicalVideoId: "core-ghost",
      language: "en",
      publiclyVisible: true,
      text: "deleted transcript",
      startSeconds: 0,
      embedding: embeddingVector(70),
    }
    const historicalEvent: Event = {
      id: "event-ghost",
      transcriptId: "transcript-deleted",
      status: "COMPLETED",
      sourceGeneration: 1n,
      currentDocumentIds: ["chunk-ghost"],
      staleDocumentIds: [],
    }
    const { prisma, typesense } = buildFixture({
      transcripts: [],
      events: [historicalEvent],
      typesenseDocuments: [orphan],
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.orphanLifecycleDocumentIds).toEqual(["chunk-ghost"])
    expect(report.ambiguousExtraDocumentIds).toEqual([])
    expect(report.enqueuedPublicationTranscriptIds).toEqual([])
  })

  it("fails closed on a document with no resolvable provenance at all", async () => {
    const unknown: TypesenseDocument = {
      id: "chunk-unknown",
      documentKind: "transcript",
      videoId: "video-unknown",
      videoEditionId: "edition-unknown",
      canonicalVideoId: "core-unknown",
      language: "en",
      publiclyVisible: true,
      text: "no provenance",
      startSeconds: 0,
      embedding: embeddingVector(80),
    }
    const { prisma, typesense } = buildFixture({
      transcripts: [],
      typesenseDocuments: [unknown],
    })

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.ambiguousExtraDocumentIds).toEqual(["chunk-unknown"])
    expect(report.orphanLifecycleDocumentIds).toEqual([])
  })

  it("fails the compare-and-set when a transcript changes mid-audit, leaving it to newer outbox work", async () => {
    const transcript: Transcript = {
      transcriptId: "transcript-7",
      videoId: "video-7",
      videoEditionId: "edition-7",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-7",
      chunks: [
        {
          chunkId: "chunk-7a",
          coreId: "core-7",
          publiclyVisible: true,
          text: "will be updated mid-audit",
          startSeconds: 0,
          embeddingSeed: 7,
        },
      ],
    }
    const existingEvent: Event = {
      id: "event-7",
      transcriptId: "transcript-7",
      status: "PENDING",
      sourceGeneration: 1n,
      currentDocumentIds: ["chunk-7a"],
      staleDocumentIds: [],
    }
    const { state, prisma, typesense } = buildFixture({
      transcripts: [transcript],
      events: [existingEvent],
      typesenseDocuments: [
        canonicalDocument(transcript, transcript.chunks[0]!),
      ],
    })

    const originalQueryRaw = prisma.$queryRaw
    let reloadCount = 0
    prisma.$queryRaw = (async (query: unknown) => {
      const text = sqlText(query)
      if (text.trim().endsWith("WHERE id = ?")) {
        reloadCount += 1
        if (reloadCount === 1) {
          return [{ sourceGeneration: 2n, sourceContentHash: "hash-7-changed" }]
        }
      }
      return (originalQueryRaw as (q: unknown) => Promise<unknown>)(query)
    }) as unknown as ReconciliationPrisma["$queryRaw"]

    const report = await auditWatchSearchTranscriptCorpus({
      prisma,
      typesense,
      dryRun: false,
    })

    expect(report.changedDuringAuditTranscriptIds).toEqual(["transcript-7"])
    expect(report.seededTranscriptIds).toEqual([])
    expect(state.events[0]!.status).toBe("PENDING")
  })

  it("reports backfillComplete only once no pending events or embedding drift remain", async () => {
    const settled: Transcript = {
      transcriptId: "transcript-done",
      videoId: "video-done",
      videoEditionId: "edition-done",
      language: "en",
      sourceGeneration: 1n,
      sourceContentHash: "hash-done",
      chunks: [
        {
          chunkId: "chunk-done",
          coreId: "core-done",
          publiclyVisible: true,
          text: "settled",
          startSeconds: 0,
          embeddingSeed: 9,
        },
      ],
    }
    const { prisma: cleanPrisma, typesense: cleanTypesense } = buildFixture({
      transcripts: [settled],
      typesenseDocuments: [canonicalDocument(settled, settled.chunks[0]!)],
    })
    const cleanReport = await auditWatchSearchTranscriptCorpus({
      prisma: cleanPrisma,
      typesense: cleanTypesense,
      dryRun: true,
    })
    expect(cleanReport.backfillComplete).toBe(true)

    const unresolved: Transcript = {
      ...settled,
      transcriptId: "transcript-pending",
      chunks: [{ ...settled.chunks[0]!, chunkId: "chunk-pending" }],
    }
    const { prisma: dirtyPrisma, typesense: dirtyTypesense } = buildFixture({
      transcripts: [unresolved],
      typesenseDocuments: [],
    })
    const dirtyReport = await auditWatchSearchTranscriptCorpus({
      prisma: dirtyPrisma,
      typesense: dirtyTypesense,
      dryRun: true,
    })
    expect(dirtyReport.backfillComplete).toBe(false)
  })
})
