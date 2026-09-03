import { createHash, randomUUID } from "node:crypto"

import {
  Prisma,
  type PrismaClient,
} from "@prisma/client"
import { env, resolveWatchSearchRuntimeEnv } from "@/config/env"
import { transcriptContentEmbeddingWhereForContractId } from "./content-embedding-contract"
import { TypesenseClient } from "./typesense-client"
import {
  parseTypesenseVector,
  canonicalTypesenseVideoId,
} from "./typesense-watch-search-indexer"
import { freezeCurrentWatchSearchProfile } from "./typesense-watch-search-profile"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import { withTypesenseWatchSearchIndexLock } from "./typesense-watch-search-publication-lock"
import type { TypesenseWatchTranscriptDocument } from "./typesense-watch-search-schema"

const LEASE_MS = 60_000
const RETRY_DELAY_MS = 5_000
const POLL_MS = 5_000

export const WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID =
  "watch-search-current-transcript-projection"

type ClaimablePublicationRow = {
  id: string
  transcriptId: string
  videoId: string
  videoEditionId: string
  language: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  sourceGeneration: bigint
  sourceContentHash: string | null
  currentDocumentIds: string[]
  staleDocumentIds: string[]
  leaseGeneration: number
  createdAt: Date
}

type ClaimedPublicationBatch = {
  eventIds: string[]
  transcriptId: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  sourceGeneration: bigint
  sourceContentHash: string | null
  currentDocumentIds: string[]
  staleDocumentIds: string[]
  leaseGeneration: number
  leaseToken: string
  leaseExpiresAt: Date
}

type CanonicalTranscriptDocumentRow = {
  id: string
  videoId: string
  videoEditionId: string
  coreId: string | null
  language: string
  publiclyVisible: boolean
  text: string
  startSeconds: number | null
  embeddingText: string
}

type CanonicalTranscriptSnapshot = {
  sourceGeneration: bigint
  sourceContentHash: string | null
  documents: TypesenseWatchTranscriptDocument[]
}

type ProjectionState = {
  transcriptCollection: string | null
  contentEmbeddingContractId: string | null
  transcriptChunkingVersion: string | null
  projectionRevision: bigint
}

type TypesenseTranscriptPublisher = Pick<
  TypesenseClient,
  "deleteDocumentsByFilter" | "getDocument" | "getAlias" | "importDocuments"
>

type WorkerGlobal = typeof globalThis & {
  __forgeAdminWatchSearchTranscriptPublication?: {
    started: boolean
    running: boolean
    timer?: ReturnType<typeof setTimeout>
  }
}

export class WatchSearchTranscriptPublicationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchTranscriptPublicationError"
  }
}

function workerGlobal(): WorkerGlobal {
  return globalThis as WorkerGlobal
}

function workerState() {
  const global = workerGlobal()
  const current = global.__forgeAdminWatchSearchTranscriptPublication
  if (current) return current
  const state = { started: false, running: false } as const
  global.__forgeAdminWatchSearchTranscriptPublication = { ...state }
  return global.__forgeAdminWatchSearchTranscriptPublication
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJson(child)]),
    )
  }
  return value
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableJson(value)))
    .digest("hex")
}

function normalizeEmbedding(value: unknown): number[] {
  const array =
    typeof value === "string"
      ? parseTypesenseVector(value)
      : Array.isArray(value)
        ? value.map((entry) => Number(entry))
        : null
  if (array == null || array.some((entry) => !Number.isFinite(entry))) {
    throw new WatchSearchTranscriptPublicationError(
      "transcript embedding readback is malformed",
    )
  }
  return array
}

function normalizeTranscriptDocument(
  document: TypesenseWatchTranscriptDocument,
): TypesenseWatchTranscriptDocument {
  return {
    id: document.id,
    documentKind: document.documentKind,
    videoId: document.videoId,
    ...(document.videoEditionId ? { videoEditionId: document.videoEditionId } : {}),
    canonicalVideoId: document.canonicalVideoId,
    language: document.language,
    publiclyVisible: document.publiclyVisible,
    text: document.text,
    startSeconds:
      document.startSeconds == null ? null : Number(document.startSeconds),
    embedding: document.embedding ? normalizeEmbedding(document.embedding) : [],
  }
}

function exactIdFilter(ids: readonly string[]): string {
  if (ids.length === 0) {
    throw new WatchSearchTranscriptPublicationError(
      "exact id filter requires at least one id",
    )
  }
  return `id:=[${ids.map((id) => `\`${id.replaceAll("`", "\\`")}\``).join(",")}]`
}

function eligibleCurrentEventWhere(now: Date) {
  return Prisma.sql`
    (
      (
        status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
      )
      OR (
        status = 'claimed'
        AND lease_expires_at <= ${now}
      )
    )
  `
}

async function claimNextTranscriptPublicationBatch(
  prisma: PrismaClient,
  now: Date,
): Promise<ClaimedPublicationBatch | null> {
  return prisma.$transaction(async (tx) => {
    const first = await tx.$queryRaw<Array<{ transcriptId: string }>>(Prisma.sql`
      SELECT transcript_id AS "transcriptId"
      FROM watch_search_current_transcript_publication_event
      WHERE ${eligibleCurrentEventWhere(now)}
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `)
    const transcriptId = first[0]?.transcriptId
    if (!transcriptId) return null

    const rows = await tx.$queryRaw<ClaimablePublicationRow[]>(Prisma.sql`
      SELECT
        id,
        transcript_id AS "transcriptId",
        video_id AS "videoId",
        video_edition_id AS "videoEditionId",
        language,
        content_embedding_contract_id AS "contentEmbeddingContractId",
        transcript_chunking_version AS "transcriptChunkingVersion",
        source_generation AS "sourceGeneration",
        source_content_hash AS "sourceContentHash",
        current_document_ids AS "currentDocumentIds",
        stale_document_ids AS "staleDocumentIds",
        lease_generation AS "leaseGeneration",
        created_at AS "createdAt"
      FROM watch_search_current_transcript_publication_event
      WHERE transcript_id = ${transcriptId}
        AND ${eligibleCurrentEventWhere(now)}
      ORDER BY source_generation DESC, created_at DESC
      FOR UPDATE
    `)
    if (rows.length === 0) return null

    const latest = rows[0]!
    const eventIds = rows.map((row) => row.id)
    const staleDocumentIds = [...new Set(rows.flatMap((row) => row.staleDocumentIds))]
    const leaseGeneration =
      rows.reduce(
        (max, row) => Math.max(max, row.leaseGeneration),
        0,
      ) + 1
    const leaseToken = randomUUID()
    const leaseTokenHash = createHash("sha256").update(leaseToken).digest("hex")
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS)
    const updated = await tx.watchSearchCurrentTranscriptPublicationEvent.updateMany(
      {
        where: { id: { in: eventIds } },
        data: {
          status: "CLAIMED",
          leaseGeneration,
          leaseTokenHash,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
          updatedAt: now,
        },
      },
    )
    if (updated.count !== eventIds.length) {
      throw new WatchSearchTranscriptPublicationError(
        "failed to claim the full transcript publication batch",
      )
    }
    return {
      eventIds,
      transcriptId,
      contentEmbeddingContractId: latest.contentEmbeddingContractId,
      transcriptChunkingVersion: latest.transcriptChunkingVersion,
      sourceGeneration: latest.sourceGeneration,
      sourceContentHash: latest.sourceContentHash,
      currentDocumentIds: latest.currentDocumentIds,
      staleDocumentIds,
      leaseGeneration,
      leaseToken,
      leaseExpiresAt,
    }
  })
}

async function loadCanonicalTranscriptSnapshot(
  prisma: PrismaClient,
  batch: ClaimedPublicationBatch,
): Promise<CanonicalTranscriptSnapshot> {
  const transcript = await prisma.videoTranscript.findUnique({
    where: { id: batch.transcriptId },
    select: {
      id: true,
      sourceGeneration: true,
      sourceContentHash: true,
      chunkingVersion: true,
    },
  })
  if (!transcript) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} does not exist`,
    )
  }
  if (transcript.sourceGeneration !== batch.sourceGeneration) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} advanced to source generation ${transcript.sourceGeneration.toString()} before publication`,
    )
  }
  if (transcript.sourceContentHash !== batch.sourceContentHash) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} source hash drifted before publication`,
    )
  }
  if (transcript.chunkingVersion !== batch.transcriptChunkingVersion) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} chunking version drifted before publication`,
    )
  }

  const rows = await prisma.$queryRaw<CanonicalTranscriptDocumentRow[]>(
    Prisma.sql`
      SELECT
        vtc.id,
        vt.video_id AS "videoId",
        vt.video_edition_id AS "videoEditionId",
        v.core_id AS "coreId",
        vtc.language,
        (
          v.deleted_at IS NULL
          AND v.no_index = FALSE
          AND EXISTS (
            SELECT 1
            FROM video_locale vl
            WHERE vl.video_id = v.id
              AND vl.locale = vtc.language
              AND vl.status = 'published'
              AND vl.deleted_at IS NULL
          )
        ) AS "publiclyVisible",
        COALESCE(
          NULLIF(vtc.content_summary, ''),
          NULLIF(vtc.raw_source_text, ''),
          vtc.text
        ) AS text,
        vtc.start_seconds AS "startSeconds",
        vtc.embedding::text AS "embeddingText"
      FROM video_transcript_chunk vtc
      JOIN video_transcript vt
        ON vt.id = vtc.transcript_id
      JOIN video v
        ON v.id = vt.video_id
      WHERE vt.id = ${batch.transcriptId}
        AND vtc.embedding IS NOT NULL
        ${transcriptContentEmbeddingWhereForContractId({
          contractId: batch.contentEmbeddingContractId,
          transcriptAlias: "vt",
          chunkAlias: "vtc",
        })}
      ORDER BY vtc.chunk_index ASC, vtc.id ASC
    `,
  )
  if (rows.length === 0) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} has no current chunk embeddings`,
    )
  }

  return {
    sourceGeneration: transcript.sourceGeneration,
    sourceContentHash: transcript.sourceContentHash,
    documents: rows.map((row) => ({
      id: row.id,
      documentKind: "transcript",
      videoId: row.videoId,
      videoEditionId: row.videoEditionId,
      canonicalVideoId: canonicalTypesenseVideoId(row.videoId, row.coreId),
      language: row.language,
      publiclyVisible: row.publiclyVisible,
      text: row.text,
      startSeconds: row.startSeconds == null ? null : Number(row.startSeconds),
      embedding: parseTypesenseVector(row.embeddingText),
    })),
  }
}

async function readBackTranscriptDocuments(
  typesense: TypesenseTranscriptPublisher,
  collection: string,
  ids: readonly string[],
): Promise<TypesenseWatchTranscriptDocument[]> {
  const rows = await Promise.all(
    ids.map((id) =>
      typesense.getDocument<TypesenseWatchTranscriptDocument & { embedding?: unknown }>(
        collection,
        id,
      ),
    ),
  )
  return rows.map((row, index) => {
    if (!row) {
      throw new WatchSearchTranscriptPublicationError(
        `Typesense transcript document ${ids[index]} is missing after publication`,
      )
    }
    return normalizeTranscriptDocument({
      ...row,
      embedding: normalizeEmbedding(row.embedding),
    })
  })
}

async function assertStaleDocumentsRemoved(
  typesense: TypesenseTranscriptPublisher,
  collection: string,
  ids: readonly string[],
): Promise<void> {
  const rows = await Promise.all(ids.map((id) => typesense.getDocument(collection, id)))
  const present = rows.findIndex((row) => row != null)
  if (present !== -1) {
    throw new WatchSearchTranscriptPublicationError(
      `stale transcript document ${ids[present]} still exists after publication`,
    )
  }
}

async function completeTranscriptPublicationBatch(
  prisma: PrismaClient,
  batch: ClaimedPublicationBatch,
  input: {
    transcriptCollection: string
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
  },
  now: Date,
): Promise<ProjectionState> {
  const leaseTokenHash = createHash("sha256")
    .update(batch.leaseToken)
    .digest("hex")
  return prisma.$transaction(async (tx) => {
    const currentTranscript = await tx.videoTranscript.findUnique({
      where: { id: batch.transcriptId },
      select: {
        sourceGeneration: true,
        sourceContentHash: true,
        chunkingVersion: true,
      },
    })
    if (
      !currentTranscript ||
      currentTranscript.sourceGeneration !== batch.sourceGeneration ||
      currentTranscript.sourceContentHash !== batch.sourceContentHash ||
      currentTranscript.chunkingVersion !== batch.transcriptChunkingVersion
    ) {
      throw new WatchSearchTranscriptPublicationError(
        "canonical transcript changed before publication completion",
      )
    }

    const projection = await tx.watchSearchCurrentTranscriptProjection.upsert({
      where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      create: {
        id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID,
        transcriptCollection: input.transcriptCollection,
        contentEmbeddingContractId: input.contentEmbeddingContractId,
        transcriptChunkingVersion: input.transcriptChunkingVersion,
        projectionRevision: 1n,
        version: 1,
      },
      update: {
        transcriptCollection: input.transcriptCollection,
        contentEmbeddingContractId: input.contentEmbeddingContractId,
        transcriptChunkingVersion: input.transcriptChunkingVersion,
        projectionRevision: { increment: 1 },
        version: { increment: 1 },
      },
    })
    const completed = await tx.watchSearchCurrentTranscriptPublicationEvent.updateMany(
      {
        where: {
          id: { in: batch.eventIds },
          status: "CLAIMED",
          leaseGeneration: batch.leaseGeneration,
          leaseTokenHash,
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: "COMPLETED",
          leaseTokenHash: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          completedAt: now,
          updatedAt: now,
        },
      },
    )
    if (completed.count !== batch.eventIds.length) {
      throw new WatchSearchTranscriptPublicationError(
        "transcript publication batch fence was lost before completion",
      )
    }
    return {
      transcriptCollection: projection.transcriptCollection,
      contentEmbeddingContractId: projection.contentEmbeddingContractId,
      transcriptChunkingVersion: projection.transcriptChunkingVersion,
      projectionRevision: projection.projectionRevision,
    }
  })
}

async function releaseTranscriptPublicationBatch(
  prisma: PrismaClient,
  batch: ClaimedPublicationBatch,
  errorCode: string,
  now: Date,
): Promise<void> {
  const leaseTokenHash = createHash("sha256")
    .update(batch.leaseToken)
    .digest("hex")
  await prisma.watchSearchCurrentTranscriptPublicationEvent.updateMany({
    where: {
      id: { in: batch.eventIds },
      status: "CLAIMED",
      leaseGeneration: batch.leaseGeneration,
      leaseTokenHash,
    },
    data: {
      status: "PENDING",
      leaseTokenHash: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
      lastErrorCode: errorCode,
      updatedAt: now,
    },
  })
}

export async function loadCurrentWatchSearchTranscriptProjection(
  prisma: PrismaClient,
): Promise<ProjectionState> {
  const row = await prisma.watchSearchCurrentTranscriptProjection.findUnique({
    where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
  })
  if (!row) {
    return {
      transcriptCollection: null,
      contentEmbeddingContractId: null,
      transcriptChunkingVersion: null,
      projectionRevision:
        resolveWatchSearchRuntimeEnv().transcriptProjectionRevision ?? 0n,
    }
  }
  return {
    transcriptCollection: row.transcriptCollection,
    contentEmbeddingContractId: row.contentEmbeddingContractId,
    transcriptChunkingVersion: row.transcriptChunkingVersion,
    projectionRevision: row.projectionRevision,
  }
}

export async function publishOneCurrentTranscriptToWatchSearch(input: {
  prisma: PrismaClient
  typesense: TypesenseTranscriptPublisher
  generations?: Pick<
    TypesenseWatchSearchCandidateGenerationService,
    "assertCurrentPublicationAllowed"
  >
  now?: Date
}): Promise<
  | { status: "idle" }
  | {
      status: "published"
      transcriptId: string
      sourceGeneration: bigint
      projectionRevision: bigint
      transcriptCollection: string
      documentCount: number
    }
> {
  const prisma = input.prisma
  const now = input.now ?? new Date()
  const batch = await claimNextTranscriptPublicationBatch(prisma, now)
  if (!batch) return { status: "idle" }

  try {
    const result = await withTypesenseWatchSearchIndexLock(async () => {
      if (input.generations) {
        await input.generations.assertCurrentPublicationAllowed({
          rebuildTranscripts: false,
        })
      }
      const profile = await freezeCurrentWatchSearchProfile(input.typesense)
      const transcriptCollection = profile.binding.transcript
      const canonical = await loadCanonicalTranscriptSnapshot(prisma, batch)
      await input.typesense.importDocuments(
        transcriptCollection,
        canonical.documents,
        "upsert",
      )
      if (batch.staleDocumentIds.length > 0) {
        await input.typesense.deleteDocumentsByFilter(
          transcriptCollection,
          exactIdFilter(batch.staleDocumentIds),
        )
      }
      const projected = await readBackTranscriptDocuments(
        input.typesense,
        transcriptCollection,
        canonical.documents.map((document) => document.id),
      )
      await assertStaleDocumentsRemoved(
        input.typesense,
        transcriptCollection,
        batch.staleDocumentIds,
      )
      const canonicalFingerprint = sha256(
        canonical.documents.map(normalizeTranscriptDocument),
      )
      const projectedFingerprint = sha256(projected)
      if (canonicalFingerprint !== projectedFingerprint) {
        throw new WatchSearchTranscriptPublicationError(
          "canonical transcript fingerprint does not match Typesense readback",
        )
      }
      const projection = await completeTranscriptPublicationBatch(
        prisma,
        batch,
        {
          transcriptCollection,
          contentEmbeddingContractId: batch.contentEmbeddingContractId,
          transcriptChunkingVersion: batch.transcriptChunkingVersion,
        },
        new Date(),
      )
      return {
        status: "published" as const,
        transcriptId: batch.transcriptId,
        sourceGeneration: canonical.sourceGeneration,
        projectionRevision: projection.projectionRevision,
        transcriptCollection,
        documentCount: canonical.documents.length,
      }
    })
    return result
  } catch (error) {
    await releaseTranscriptPublicationBatch(
      prisma,
      batch,
      error instanceof Error ? error.name : "publication_failed",
      new Date(),
    ).catch(() => undefined)
    throw error
  }
}

function scheduleNextWorkerRun(
  typesense: TypesenseClient,
  prisma: PrismaClient,
  generations: TypesenseWatchSearchCandidateGenerationService,
): void {
  const state = workerState()
  state.timer = setTimeout(async () => {
    state.timer = undefined
    if (state.running) {
      scheduleNextWorkerRun(typesense, prisma, generations)
      return
    }
    state.running = true
    try {
      await publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
      })
    } catch (error) {
      console.warn(
        `[watch-search-transcript-publication] event=worker_tick_failed error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      )
    } finally {
      state.running = false
      scheduleNextWorkerRun(typesense, prisma, generations)
    }
  }, POLL_MS)
  state.timer.unref?.()
}

export async function ensureWatchSearchTranscriptPublicationWorkerStarted(
  prisma: PrismaClient,
): Promise<
  | { started: true }
  | { started: false; reason: "already-started" | "disabled" | "missing-config" }
> {
  const enabled = env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED === true
  if (!enabled) {
    return { started: false, reason: "disabled" }
  }
  const host = env.TYPESENSE_HOST
  const apiKey = env.TYPESENSE_OPERATOR_API_KEY
  if (!host || !apiKey) {
    return { started: false, reason: "missing-config" }
  }
  const state = workerState()
  if (state.started) {
    return { started: false, reason: "already-started" }
  }
  const typesense = new TypesenseClient({
    host,
    apiKey,
    timeoutMs: 30_000,
  })
  const generations = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )
  state.started = true
  scheduleNextWorkerRun(typesense, prisma, generations)
  return { started: true }
}

export const _internals = {
  exactIdFilter,
  normalizeEmbedding,
  normalizeTranscriptDocument,
  sha256,
}
