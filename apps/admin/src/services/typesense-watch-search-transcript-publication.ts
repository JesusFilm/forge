import { createHash, randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "@prisma/client"
import {
  env,
  resolveWatchSearchRuntimeEnv,
  resolveWatchSearchTranscriptPublicationEnabled,
} from "@/config/env"
import { transcriptContentEmbeddingWhereForContractId } from "./content-embedding-contract"
import {
  TypesenseClient,
  type TypesenseCollection,
  type TypesenseCollectionField,
} from "./typesense-client"
import {
  advanceCurrentWatchSearchTranscriptProjection,
  initialCurrentWatchSearchTranscriptProjectionRevision,
  resolveCurrentWatchSearchTranscriptProjectionWithFallback,
  WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID as CURRENT_TRANSCRIPT_PROJECTION_ID,
} from "./typesense-watch-search-current-transcript-projection"
import {
  parseTypesenseVector,
  canonicalTypesenseVideoId,
} from "./typesense-watch-search-indexer"
import { freezeCurrentWatchSearchProfile } from "./typesense-watch-search-profile"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import { withTypesenseWatchSearchIndexLock } from "./typesense-watch-search-publication-lock"
import {
  type TypesenseWatchTranscriptDocument,
  watchTranscriptCollectionSchema,
} from "./typesense-watch-search-schema"

const BASE_LEASE_MS = 60_000
const MAX_LEASE_MS = 5 * 60_000
const LEASE_PER_DOCUMENT_MS = 250
const READBACK_CONCURRENCY = 16
const UPSERT_BATCH_SIZE = 100
const STALE_DELETE_BATCH_SIZE = 100
const BASE_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 5 * 60_000
const POLL_MS = 5_000

export const WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID =
  CURRENT_TRANSCRIPT_PROJECTION_ID

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
  attemptCount: number
  createdAt: Date
}

type ClaimedPublicationBatch = {
  eventIds: string[]
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
  attemptCount: number
  leaseToken: string
  leaseExpiresAt: Date
}

type OutstandingStaleDocumentEvidenceRow = {
  staleDocumentIds: string[]
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

type IncrementalPublicationIdentity = {
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
}

type CanonicalTranscriptSnapshotReader = Pick<
  PrismaClient,
  "videoTranscript" | "$queryRaw"
> &
  Pick<Prisma.TransactionClient, "videoTranscript" | "$queryRaw">

type TypesenseTranscriptPublisher = Pick<
  TypesenseClient,
  | "deleteDocumentsByFilter"
  | "getCollectionSchema"
  | "getDocument"
  | "getAlias"
  | "importDocuments"
>

type IndexLockRunner = <T>(run: () => Promise<T>) => Promise<T>

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

export class WatchSearchTranscriptPublicationCompletionIndeterminateError extends Error {
  constructor(
    readonly completionError: unknown,
    readonly reconciliationError: unknown,
  ) {
    super("transcript publication completion outcome could not be reconciled", {
      cause: reconciliationError,
    })
    this.name = "WatchSearchTranscriptPublicationCompletionIndeterminateError"
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

function publicationLeaseMs(input: {
  currentDocumentCount: number
  staleDocumentCount: number
}): number {
  const totalDocuments = Math.max(
    0,
    input.currentDocumentCount + input.staleDocumentCount,
  )
  return Math.min(
    MAX_LEASE_MS,
    BASE_LEASE_MS + totalDocuments * LEASE_PER_DOCUMENT_MS,
  )
}

function publicationRetryDelayMs(attemptCount: number): number {
  const normalizedAttemptCount = Math.max(1, Math.floor(attemptCount))
  return Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** Math.min(normalizedAttemptCount - 1, 6),
  )
}

function initialProjectionRevision(): bigint {
  return initialCurrentWatchSearchTranscriptProjectionRevision()
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
  const normalized = array.map(Math.fround)
  if (normalized.some((entry) => !Number.isFinite(entry))) {
    throw new WatchSearchTranscriptPublicationError(
      "transcript embedding readback exceeds Typesense float storage",
    )
  }
  return normalized
}

function normalizeTypesenseFloat(value: number): number {
  const normalized = Math.fround(value)
  if (!Number.isFinite(normalized)) {
    throw new WatchSearchTranscriptPublicationError(
      "transcript numeric readback exceeds Typesense float storage",
    )
  }
  return normalized
}

function normalizeTranscriptDocument(
  document: TypesenseWatchTranscriptDocument,
): TypesenseWatchTranscriptDocument {
  return {
    id: document.id,
    documentKind: document.documentKind,
    videoId: document.videoId,
    ...(document.videoEditionId
      ? { videoEditionId: document.videoEditionId }
      : {}),
    canonicalVideoId: document.canonicalVideoId,
    language: document.language,
    publiclyVisible: document.publiclyVisible,
    text: document.text,
    startSeconds:
      document.startSeconds == null
        ? null
        : normalizeTypesenseFloat(Number(document.startSeconds)),
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

async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  mapper: (value: Value, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (values.length === 0) return []
  const normalizedConcurrency = Math.max(
    1,
    Math.min(concurrency, values.length),
  )
  const results = new Array<Result>(values.length)
  let nextIndex = 0

  const worker = async () => {
    for (;;) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= values.length) return
      results[currentIndex] = await mapper(values[currentIndex]!, currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, () => worker()),
  )
  return results
}

function assertCanonicalDocumentIdsMatchBatch(
  actualIds: readonly string[],
  expectedIds: readonly string[],
): void {
  if (actualIds.length !== expectedIds.length) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript chunk count ${actualIds.length} does not match batch evidence ${expectedIds.length}`,
    )
  }
  for (let index = 0; index < expectedIds.length; index += 1) {
    if (actualIds[index] !== expectedIds[index]) {
      throw new WatchSearchTranscriptPublicationError(
        `canonical transcript chunk evidence drifted at index ${index}: expected ${expectedIds[index]}, got ${actualIds[index] ?? "<missing>"}`,
      )
    }
  }
}

function assertIncrementalPublicationIdentity(
  current: ProjectionState,
  next: IncrementalPublicationIdentity,
): void {
  // A stored row certifies the identity of the whole transcript collection.
  // Verifying one changed transcript may advance its revision, but only a full
  // rebuild can safely certify a different collection or compatibility tuple.
  const currentIdentity = [
    current.transcriptCollection,
    current.contentEmbeddingContractId,
    current.transcriptChunkingVersion,
  ]
  if (currentIdentity.every((value) => value == null)) return
  if (
    current.transcriptCollection !== next.transcriptCollection ||
    current.contentEmbeddingContractId !== next.contentEmbeddingContractId ||
    current.transcriptChunkingVersion !== next.transcriptChunkingVersion
  ) {
    throw new WatchSearchTranscriptPublicationError(
      "incremental transcript publication identity drifted; a full transcript rebuild is required",
    )
  }
}

const REQUIRED_TRANSCRIPT_COLLECTION_FIELDS = watchTranscriptCollectionSchema(
  "incremental-publication-schema",
).fields

function assertIncrementalTranscriptCollectionSchema(
  collectionName: string,
  actual: TypesenseCollection,
): void {
  if (actual.name !== collectionName) {
    throw new WatchSearchTranscriptPublicationError(
      `Typesense returned transcript schema ${actual.name} for ${collectionName}`,
    )
  }
  if (actual.fields.length !== REQUIRED_TRANSCRIPT_COLLECTION_FIELDS.length) {
    throw new WatchSearchTranscriptPublicationError(
      `active transcript collection ${collectionName} field count does not match the Watch Search reader contract`,
    )
  }

  const actualByName = new Map(
    actual.fields.map((field) => [field.name, field]),
  )
  for (const expected of REQUIRED_TRANSCRIPT_COLLECTION_FIELDS) {
    const observed = actualByName.get(expected.name)
    if (!observed || observed.type !== expected.type) {
      throw new WatchSearchTranscriptPublicationError(
        `active transcript collection ${collectionName} field ${expected.name} does not match the Watch Search reader contract`,
      )
    }
    for (const key of [
      "facet",
      "index",
      "locale",
      "optional",
      "sort",
      "num_dim",
    ] as const satisfies readonly (keyof TypesenseCollectionField)[]) {
      if (expected[key] !== undefined && observed[key] !== expected[key]) {
        throw new WatchSearchTranscriptPublicationError(
          `active transcript collection ${collectionName} field ${expected.name} does not match the Watch Search reader contract`,
        )
      }
    }
  }
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

function claimableTranscriptBatchWhere(now: Date) {
  return Prisma.sql`
    status != 'completed'
    AND NOT (
      status = 'claimed'
      AND lease_expires_at > ${now}
    )
  `
}

async function claimNextTranscriptPublicationBatch(
  prisma: PrismaClient,
  now: Date,
): Promise<ClaimedPublicationBatch | null> {
  return prisma.$transaction(async (tx) => {
    const first = await tx.$queryRaw<
      Array<{ transcriptId: string }>
    >(Prisma.sql`
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
        attempt_count AS "attemptCount",
        created_at AS "createdAt"
      FROM watch_search_current_transcript_publication_event
      WHERE transcript_id = ${transcriptId}
        AND ${claimableTranscriptBatchWhere(now)}
      ORDER BY source_generation DESC, created_at DESC
      FOR UPDATE
    `)
    if (rows.length === 0) return null

    const latest = rows[0]!
    const eventIds = rows.map((row) => row.id)
    // Include immutable deletion evidence from older events that another
    // worker has already claimed. A newer generation can win the shared index
    // lock before that worker starts, and the newer transition may no longer
    // repeat ids made stale by an intermediate generation.
    const outstandingStaleEvidence = await tx.$queryRaw<
      OutstandingStaleDocumentEvidenceRow[]
    >(Prisma.sql`
      SELECT stale_document_ids AS "staleDocumentIds"
      FROM watch_search_current_transcript_publication_event
      WHERE transcript_id = ${transcriptId}
        AND status != 'completed'
    `)
    const staleDocumentIds = [
      ...new Set(
        outstandingStaleEvidence.flatMap((row) => row.staleDocumentIds),
      ),
    ]
    const leaseGeneration =
      rows.reduce((max, row) => Math.max(max, row.leaseGeneration), 0) + 1
    const attemptCount =
      rows.reduce((max, row) => Math.max(max, row.attemptCount), 0) + 1
    const leaseToken = randomUUID()
    const leaseTokenHash = createHash("sha256").update(leaseToken).digest("hex")
    const leaseExpiresAt = new Date(
      now.getTime() +
        publicationLeaseMs({
          currentDocumentCount: latest.currentDocumentIds.length,
          staleDocumentCount: staleDocumentIds.length,
        }),
    )
    const updated =
      await tx.watchSearchCurrentTranscriptPublicationEvent.updateMany({
        where: { id: { in: eventIds } },
        data: {
          status: "CLAIMED",
          leaseGeneration,
          leaseTokenHash,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
          updatedAt: now,
        },
      })
    if (updated.count !== eventIds.length) {
      throw new WatchSearchTranscriptPublicationError(
        "failed to claim the full transcript publication batch",
      )
    }
    return {
      eventIds,
      transcriptId,
      videoId: latest.videoId,
      videoEditionId: latest.videoEditionId,
      language: latest.language,
      contentEmbeddingContractId: latest.contentEmbeddingContractId,
      transcriptChunkingVersion: latest.transcriptChunkingVersion,
      sourceGeneration: latest.sourceGeneration,
      sourceContentHash: latest.sourceContentHash,
      currentDocumentIds: latest.currentDocumentIds,
      staleDocumentIds,
      leaseGeneration,
      attemptCount,
      leaseToken,
      leaseExpiresAt,
    }
  })
}

async function loadCanonicalTranscriptSnapshot(
  prisma: CanonicalTranscriptSnapshotReader,
  batch: ClaimedPublicationBatch,
): Promise<CanonicalTranscriptSnapshot> {
  const transcript = await prisma.videoTranscript.findUnique({
    where: { id: batch.transcriptId },
    select: {
      id: true,
      videoId: true,
      videoEditionId: true,
      language: true,
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
  if (
    transcript.videoId !== batch.videoId ||
    transcript.videoEditionId !== batch.videoEditionId ||
    transcript.language !== batch.language
  ) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} identity does not match publication evidence`,
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
          AND NOT ('watch' = ANY(v.restrict_view_platforms))
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
  if (
    rows.some(
      (row) =>
        row.videoId !== batch.videoId ||
        row.videoEditionId !== batch.videoEditionId ||
        row.language !== batch.language,
    )
  ) {
    throw new WatchSearchTranscriptPublicationError(
      `canonical transcript ${batch.transcriptId} chunk identity does not match publication evidence`,
    )
  }
  assertCanonicalDocumentIdsMatchBatch(
    rows.map((row) => row.id),
    batch.currentDocumentIds,
  )

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
  const rows = await mapWithConcurrency(ids, READBACK_CONCURRENCY, (id) =>
    typesense.getDocument<
      TypesenseWatchTranscriptDocument & { embedding?: unknown }
    >(collection, id),
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
  const rows = await mapWithConcurrency(ids, READBACK_CONCURRENCY, (id) =>
    typesense.getDocument(collection, id),
  )
  const present = rows.findIndex((row) => row != null)
  if (present !== -1) {
    throw new WatchSearchTranscriptPublicationError(
      `stale transcript document ${ids[present]} still exists after publication`,
    )
  }
}

async function deleteStaleTranscriptDocuments(
  typesense: Pick<TypesenseTranscriptPublisher, "deleteDocumentsByFilter">,
  collection: string,
  ids: readonly string[],
): Promise<void> {
  for (let index = 0; index < ids.length; index += STALE_DELETE_BATCH_SIZE) {
    await typesense.deleteDocumentsByFilter(
      collection,
      exactIdFilter(ids.slice(index, index + STALE_DELETE_BATCH_SIZE)),
    )
  }
}

async function upsertCurrentTranscriptDocuments(
  typesense: Pick<TypesenseTranscriptPublisher, "importDocuments">,
  collection: string,
  documents: readonly TypesenseWatchTranscriptDocument[],
): Promise<void> {
  for (let index = 0; index < documents.length; index += UPSERT_BATCH_SIZE) {
    await typesense.importDocuments(
      collection,
      documents.slice(index, index + UPSERT_BATCH_SIZE),
      "upsert",
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
    projectedFingerprint: string
  },
  now: Date,
): Promise<ProjectionState> {
  const leaseTokenHash = createHash("sha256")
    .update(batch.leaseToken)
    .digest("hex")
  try {
    return await prisma.$transaction(
      async (tx) => {
        const canonical = await loadCanonicalTranscriptSnapshot(tx, batch)
        const latestCanonicalFingerprint = sha256(
          canonical.documents.map(normalizeTranscriptDocument),
        )
        if (latestCanonicalFingerprint !== input.projectedFingerprint) {
          throw new WatchSearchTranscriptPublicationError(
            "canonical transcript projection changed before publication completion",
          )
        }

        const projection = await advanceCurrentWatchSearchTranscriptProjection(
          tx,
          {
            transcriptCollection: input.transcriptCollection,
            contentEmbeddingContractId: input.contentEmbeddingContractId,
            transcriptChunkingVersion: input.transcriptChunkingVersion,
          },
        )
        const completion = {
          status: "COMPLETED" as const,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          completedAt: now,
          updatedAt: now,
        }
        const completed =
          await tx.watchSearchCurrentTranscriptPublicationEvent.updateMany({
            where: {
              id: { in: batch.eventIds },
              status: "CLAIMED",
              leaseGeneration: batch.leaseGeneration,
              leaseTokenHash,
            },
            data: completion,
          })
        if (completed.count !== batch.eventIds.length) {
          throw new WatchSearchTranscriptPublicationError(
            "transcript publication batch fence was lost before completion",
          )
        }
        // An older generation can still own an unexpired event lease while this
        // batch claims and publishes the latest generation. The shared Typesense
        // index lock guarantees that older worker cannot publish concurrently.
        // Complete those now-superseded events in the same transaction so they
        // cannot later retry forever against the newer canonical generation.
        await tx.watchSearchCurrentTranscriptPublicationEvent.updateMany({
          where: {
            transcriptId: batch.transcriptId,
            sourceGeneration: { lt: batch.sourceGeneration },
            status: { not: "COMPLETED" },
          },
          data: completion,
        })
        return {
          transcriptCollection: projection.transcriptCollection,
          contentEmbeddingContractId: projection.contentEmbeddingContractId,
          transcriptChunkingVersion: projection.transcriptChunkingVersion,
          projectionRevision: projection.projectionRevision,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (completionError) {
    // PostgreSQL can commit a transaction and then lose the acknowledgement
    // while returning it to the client. Treating every thrown commit as a
    // rollback would delete the verified Typesense documents even though the
    // event is already durably complete, leaving no pending work to restore
    // them. Re-read the atomic completion evidence before compensation.
    try {
      const events =
        await prisma.watchSearchCurrentTranscriptPublicationEvent.findMany({
          where: { id: { in: batch.eventIds } },
          select: {
            id: true,
            status: true,
            completedAt: true,
            leaseGeneration: true,
            leaseTokenHash: true,
          },
        })
      const completeEvents = events.filter(
        (event) => event.status === "COMPLETED",
      )
      if (completeEvents.length > 0) {
        if (
          events.length !== batch.eventIds.length ||
          completeEvents.length !== batch.eventIds.length ||
          completeEvents.some(
            (event) => event.completedAt?.getTime() !== now.getTime(),
          )
        ) {
          throw new WatchSearchTranscriptPublicationError(
            "transcript publication completion was superseded by another attempt",
          )
        }
        const projection =
          await prisma.watchSearchCurrentTranscriptProjection.findUnique({
            where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
          })
        if (
          projection?.transcriptCollection === input.transcriptCollection &&
          projection.contentEmbeddingContractId ===
            input.contentEmbeddingContractId &&
          projection.transcriptChunkingVersion ===
            input.transcriptChunkingVersion &&
          projection.projectionRevision >= 1n
        ) {
          return {
            transcriptCollection: projection.transcriptCollection,
            contentEmbeddingContractId: projection.contentEmbeddingContractId,
            transcriptChunkingVersion: projection.transcriptChunkingVersion,
            projectionRevision: projection.projectionRevision,
          }
        }
        throw new WatchSearchTranscriptPublicationError(
          "completed transcript publication has mismatched projection state",
        )
      }
      const stillOwned =
        events.length === batch.eventIds.length &&
        events.every(
          (event) =>
            event.status === "CLAIMED" &&
            event.leaseGeneration === batch.leaseGeneration &&
            event.leaseTokenHash === leaseTokenHash,
        )
      if (events.length !== 0 && !stillOwned) {
        throw new WatchSearchTranscriptPublicationError(
          "transcript publication claim changed while completion was indeterminate",
        )
      }
    } catch (reconciliationError) {
      throw new WatchSearchTranscriptPublicationCompletionIndeterminateError(
        completionError,
        reconciliationError,
      )
    }
    throw completionError
  }
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
      // Back off a poison transcript long enough for later healthy events to
      // become the oldest eligible work instead of letting one permanent
      // projection error monopolize every worker tick.
      nextAttemptAt: new Date(
        now.getTime() + publicationRetryDelayMs(batch.attemptCount),
      ),
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

async function loadIncrementalPublicationProjectionState(input: {
  prisma: PrismaClient
  typesense: Pick<TypesenseTranscriptPublisher, "getDocument">
  transcriptCollection: string
  collection: TypesenseCollection
  affectedDocumentIds: readonly string[]
}): Promise<ProjectionState> {
  const stored = await loadCurrentWatchSearchTranscriptProjection(input.prisma)
  const hasNoStoredIdentity =
    stored.transcriptCollection == null &&
    stored.contentEmbeddingContractId == null &&
    stored.transcriptChunkingVersion == null
  if (!hasNoStoredIdentity) return stored

  // An empty collection has no existing corpus identity to preserve, so its
  // first verified event may establish the durable projection.
  if (input.collection.num_documents === 0) return stored

  // A failed first attempt can leave only this batch's documents behind when
  // fail-closed cleanup is itself unavailable. The lease-fenced retry will
  // overwrite or delete that entire corpus, so it remains safe to bootstrap.
  // A populated pre-migration collection is different: one changed transcript
  // cannot certify the compatibility of documents outside its affected set.
  if (input.collection.num_documents != null) {
    const affectedDocumentIds = [...new Set(input.affectedDocumentIds)]
    const existingAffectedDocuments = await mapWithConcurrency(
      affectedDocumentIds,
      READBACK_CONCURRENCY,
      (id) => input.typesense.getDocument(input.transcriptCollection, id),
    )
    if (
      existingAffectedDocuments.filter((document) => document != null)
        .length === input.collection.num_documents
    ) {
      return stored
    }
  }

  return resolveCurrentWatchSearchTranscriptProjectionWithFallback({
    prisma: input.prisma,
    currentProfile: {
      binding: { transcript: input.transcriptCollection },
    },
  })
}

export async function publishOneCurrentTranscriptToWatchSearch(input: {
  prisma: PrismaClient
  typesense: TypesenseTranscriptPublisher
  generations?: Pick<
    TypesenseWatchSearchCandidateGenerationService,
    "assertCurrentPublicationAllowed"
  >
  now?: Date
  withIndexLock?: IndexLockRunner
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
  const withIndexLock =
    input.withIndexLock ?? ((run) => withTypesenseWatchSearchIndexLock(run))
  let claimedBatch: ClaimedPublicationBatch | null = null
  let releaseClaimedBatchOnFailure = true

  try {
    const result = await withIndexLock(async () => {
      // Claim only after the session-level publication lock is held. This
      // prevents a losing publisher or rebuild contender from rewriting an
      // event lease that the lock owner is still processing. The lock remains
      // held through the external write, readback, and fenced DB completion.
      const batch = await claimNextTranscriptPublicationBatch(prisma, now)
      if (!batch) return { status: "idle" as const }
      claimedBatch = batch
      let transcriptCollection: string | null = null
      let typesenseMutationStarted = false
      try {
        if (input.generations) {
          await input.generations.assertCurrentPublicationAllowed({
            rebuildTranscripts: false,
          })
        }
        const profile = await freezeCurrentWatchSearchProfile(input.typesense)
        transcriptCollection = profile.binding.transcript
        const transcriptCollectionSchema =
          await input.typesense.getCollectionSchema(transcriptCollection)
        assertIncrementalTranscriptCollectionSchema(
          transcriptCollection,
          transcriptCollectionSchema,
        )
        assertIncrementalPublicationIdentity(
          await loadIncrementalPublicationProjectionState({
            prisma,
            typesense: input.typesense,
            transcriptCollection,
            collection: transcriptCollectionSchema,
            affectedDocumentIds: [
              ...batch.currentDocumentIds,
              ...batch.staleDocumentIds,
            ],
          }),
          {
            transcriptCollection,
            contentEmbeddingContractId: batch.contentEmbeddingContractId,
            transcriptChunkingVersion: batch.transcriptChunkingVersion,
          },
        )
        const canonical = await loadCanonicalTranscriptSnapshot(prisma, batch)
        // Import endpoints may apply a prefix of a JSONL request before
        // returning an error. From this point onward, every failure must
        // therefore fail closed by removing the complete affected transcript
        // set while the shared publication lock is still held.
        typesenseMutationStarted = true
        await upsertCurrentTranscriptDocuments(
          input.typesense,
          transcriptCollection,
          canonical.documents,
        )
        await deleteStaleTranscriptDocuments(
          input.typesense,
          transcriptCollection,
          batch.staleDocumentIds,
        )
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
        const verifiedProfile = await freezeCurrentWatchSearchProfile(
          input.typesense,
        )
        if (verifiedProfile.binding.transcript !== transcriptCollection) {
          throw new WatchSearchTranscriptPublicationError(
            "current transcript alias changed during publication",
          )
        }
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
            projectedFingerprint,
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
      } catch (error) {
        if (
          error instanceof
          WatchSearchTranscriptPublicationCompletionIndeterminateError
        ) {
          // Do not compensate an indeterminate commit. The transaction may be
          // durably complete, in which case deleting the documents would make
          // that terminal event unrecoverable. If it rolled back, the preserved
          // claim expires and the normal idempotent retry reconciles the work.
          releaseClaimedBatchOnFailure = false
          throw error
        }
        if (typesenseMutationStarted && transcriptCollection) {
          const affectedDocumentIds = [
            ...new Set([
              ...batch.currentDocumentIds,
              ...batch.staleDocumentIds,
            ]),
          ]
          try {
            await deleteStaleTranscriptDocuments(
              input.typesense,
              transcriptCollection,
              affectedDocumentIds,
            )
            await assertStaleDocumentsRemoved(
              input.typesense,
              transcriptCollection,
              affectedDocumentIds,
            )
          } catch (cleanupError) {
            // Preserve the claim fence when compensating cleanup cannot be
            // verified. Clearing it here would advertise the event as safely
            // retryable even though this attempt may still have visible
            // documents in Typesense. A later worker can reclaim the event
            // after its lease expires and repeat the full idempotent publish.
            releaseClaimedBatchOnFailure = false
            throw new AggregateError(
              [error, cleanupError],
              "transcript publication failed and fail-closed Typesense cleanup did not complete",
            )
          }
        }
        throw error
      }
    })
    return result
  } catch (error) {
    if (claimedBatch && releaseClaimedBatchOnFailure) {
      await releaseTranscriptPublicationBatch(
        prisma,
        claimedBatch,
        error instanceof Error ? error.name : "publication_failed",
        new Date(),
      ).catch(() => undefined)
    }
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
  | {
      started: false
      reason: "already-started" | "disabled"
    }
> {
  const enabled = resolveWatchSearchTranscriptPublicationEnabled()
  if (!enabled) {
    return { started: false, reason: "disabled" }
  }
  const host = env.TYPESENSE_HOST
  const apiKey = env.TYPESENSE_OPERATOR_API_KEY
  if (!host || !apiKey) {
    throw new WatchSearchTranscriptPublicationError(
      "WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED requires TYPESENSE_HOST and TYPESENSE_OPERATOR_API_KEY",
    )
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
  assertIncrementalPublicationIdentity,
  deleteStaleTranscriptDocuments,
  exactIdFilter,
  initialProjectionRevision,
  mapWithConcurrency,
  normalizeEmbedding,
  normalizeTranscriptDocument,
  publicationLeaseMs,
  publicationRetryDelayMs,
  sha256,
  upsertCurrentTranscriptDocuments,
}
