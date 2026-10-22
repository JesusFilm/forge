import { Prisma, type PrismaClient } from "@prisma/client"
import { transcriptContentEmbeddingWhereForContractId } from "./content-embedding-contract"
import {
  advanceCurrentWatchSearchTranscriptProjection,
  type CurrentWatchSearchTranscriptProjection,
} from "./typesense-watch-search-current-transcript-projection"
import {
  canonicalTypesenseVideoId,
  parseTypesenseVector,
} from "./typesense-watch-search-indexer"
import { freezeCurrentWatchSearchProfile } from "./typesense-watch-search-profile"
import type { TypesenseWatchTranscriptDocument } from "./typesense-watch-search-schema"
import { resolveCurrentWatchSearchTranscriptCompatibility } from "./typesense-watch-search-transcript-compatibility"
import {
  loadCurrentWatchSearchTranscriptProjection,
  mapWithConcurrency,
  normalizeTranscriptDocument,
  sha256,
} from "./typesense-watch-search-transcript-publication"
import type { TypesenseClient } from "./typesense-client"

const READBACK_CONCURRENCY = 16
const ORPHAN_LOOKUP_BATCH_SIZE = 500

export class WatchSearchTranscriptReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchTranscriptReconciliationError"
  }
}

export type ReconciliationPrisma = Pick<
  PrismaClient,
  | "$queryRaw"
  | "watchSearchCurrentTranscriptPublicationEvent"
  | "watchSearchCurrentTranscriptProjection"
>

export type ReconciliationTypesense = Pick<
  TypesenseClient,
  "getAlias" | "getDocument" | "exportDocuments"
>

export type WatchSearchTranscriptReconciliationInput = Readonly<{
  prisma: ReconciliationPrisma
  typesense: ReconciliationTypesense
  now?: Date
  dryRun?: boolean
}>

export type WatchSearchTranscriptReconciliationReport = Readonly<{
  watermark: string
  dryRun: boolean
  transcriptCollection: string
  contentEmbeddingContractId: string
  transcriptChunkingVersion: string
  totalCanonicalTranscripts: number
  exactMatchTranscriptIds: readonly string[]
  seededTranscriptIds: readonly string[]
  embeddingDriftTranscriptIds: readonly string[]
  enqueuedPublicationTranscriptIds: readonly string[]
  alreadyRepresentedTranscriptIds: readonly string[]
  visibilityOnlyDriftTranscriptIds: readonly string[]
  changedDuringAuditTranscriptIds: readonly string[]
  orphanLifecycleDocumentIds: readonly string[]
  ambiguousExtraDocumentIds: readonly string[]
  pendingOrClaimedEventCount: number
  backfillComplete: boolean
}>

type CanonicalChunkRow = {
  transcriptId: string
  videoId: string
  videoEditionId: string
  language: string
  sourceGeneration: bigint
  sourceContentHash: string | null
  chunkId: string
  coreId: string | null
  publiclyVisible: boolean
  text: string
  startSeconds: number | null
  embeddingText: string
}

type CanonicalTranscript = {
  transcriptId: string
  videoId: string
  videoEditionId: string
  language: string
  sourceGeneration: bigint
  sourceContentHash: string | null
  documents: TypesenseWatchTranscriptDocument[]
}

type TranscriptGenerationRow = {
  sourceGeneration: bigint
  sourceContentHash: string | null
}

type NonCompletedEventRow = {
  id: string
  transcriptId: string
  status: string
  sourceGeneration: bigint
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * Embedding-owned content: what the publisher writes and verifies. Changing
 * these fields is the drift this audit is allowed to repair automatically.
 */
function embeddingFieldsDigest(
  document: TypesenseWatchTranscriptDocument,
): string {
  return sha256({
    text: document.text,
    startSeconds: document.startSeconds,
    embedding: document.embedding ?? [],
  })
}

/**
 * Catalog-lifecycle-owned content (visibility, canonical video identity).
 * These can drift independently of embeddings and are scoped to a separate,
 * not-yet-built lifecycle publisher — reported here, never repaired.
 */
function lifecycleFieldsDigest(
  document: TypesenseWatchTranscriptDocument,
): string {
  return sha256({
    publiclyVisible: document.publiclyVisible,
    canonicalVideoId: document.canonicalVideoId,
  })
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  )
}

async function loadCanonicalTranscripts(
  prisma: ReconciliationPrisma,
  contentEmbeddingContractId: string,
): Promise<CanonicalTranscript[]> {
  const rows = await prisma.$queryRaw<CanonicalChunkRow[]>(Prisma.sql`
    SELECT
      vt.id AS "transcriptId",
      vt.video_id AS "videoId",
      vt.video_edition_id AS "videoEditionId",
      vt.language,
      vt.source_generation AS "sourceGeneration",
      vt.source_content_hash AS "sourceContentHash",
      vtc.id AS "chunkId",
      v.core_id AS "coreId",
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
    WHERE vtc.embedding IS NOT NULL
      ${transcriptContentEmbeddingWhereForContractId({
        contractId: contentEmbeddingContractId,
        transcriptAlias: "vt",
        chunkAlias: "vtc",
      })}
    ORDER BY vt.id ASC, vtc.chunk_index ASC, vtc.id ASC
  `)

  const byTranscript = new Map<string, CanonicalTranscript>()
  for (const row of rows) {
    let transcript = byTranscript.get(row.transcriptId)
    if (!transcript) {
      transcript = {
        transcriptId: row.transcriptId,
        videoId: row.videoId,
        videoEditionId: row.videoEditionId,
        language: row.language,
        sourceGeneration: row.sourceGeneration,
        sourceContentHash: row.sourceContentHash,
        documents: [],
      }
      byTranscript.set(row.transcriptId, transcript)
    }
    transcript.documents.push({
      id: row.chunkId,
      documentKind: "transcript",
      videoId: row.videoId,
      videoEditionId: row.videoEditionId,
      canonicalVideoId: canonicalTypesenseVideoId(row.videoId, row.coreId),
      language: row.language,
      publiclyVisible: row.publiclyVisible,
      text: row.text,
      startSeconds: row.startSeconds == null ? null : Number(row.startSeconds),
      embedding: parseTypesenseVector(row.embeddingText),
    })
  }
  return [...byTranscript.values()]
}

async function reloadTranscriptGeneration(
  prisma: ReconciliationPrisma,
  transcriptId: string,
): Promise<TranscriptGenerationRow | null> {
  const rows = await prisma.$queryRaw<TranscriptGenerationRow[]>(Prisma.sql`
    SELECT
      source_generation AS "sourceGeneration",
      source_content_hash AS "sourceContentHash"
    FROM video_transcript
    WHERE id = ${transcriptId}
  `)
  return rows[0] ?? null
}

async function loadChunkOwners(
  prisma: ReconciliationPrisma,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const owners = new Map<string, string>()
  for (const batch of chunkArray(ids, ORPHAN_LOOKUP_BATCH_SIZE)) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; transcriptId: string }>
    >(
      Prisma.sql`
        SELECT id, transcript_id AS "transcriptId"
        FROM video_transcript_chunk
        WHERE id IN (${Prisma.join(batch)})
      `,
    )
    for (const row of rows) owners.set(row.id, row.transcriptId)
  }
  return owners
}

async function loadHistoricalEventOwners(
  prisma: ReconciliationPrisma,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const owners = new Map<string, string>()
  for (const batch of chunkArray(ids, ORPHAN_LOOKUP_BATCH_SIZE)) {
    const rows = await prisma.$queryRaw<
      Array<{ documentId: string; transcriptId: string }>
    >(Prisma.sql`
      SELECT doc AS "documentId", event.transcript_id AS "transcriptId"
      FROM watch_search_current_transcript_publication_event event
      CROSS JOIN LATERAL unnest(
        event.current_document_ids || event.stale_document_ids
      ) AS doc
      WHERE doc IN (${Prisma.join(batch)})
    `)
    for (const row of rows) owners.set(row.documentId, row.transcriptId)
  }
  return owners
}

async function ensureProjectionEstablished(
  prisma: ReconciliationPrisma,
  input: {
    transcriptCollection: string
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
  },
): Promise<CurrentWatchSearchTranscriptProjection> {
  const stored = await loadCurrentWatchSearchTranscriptProjection(prisma)
  if (stored.transcriptCollection != null) {
    return {
      transcriptCollection: stored.transcriptCollection,
      contentEmbeddingContractId: stored.contentEmbeddingContractId!,
      transcriptChunkingVersion: stored.transcriptChunkingVersion!,
      projectionRevision: stored.projectionRevision,
    }
  }
  // The watermark audit is the bootstrap path: nothing has verified the
  // active collection against canonical Postgres before. Establishing the
  // projection here never imports anything into Typesense — it only records
  // that the existing broad corpus has been proven correct at this
  // watermark.
  return advanceCurrentWatchSearchTranscriptProjection(prisma, input)
}

/**
 * Dry-run-first watermark audit for the existing transcript corpus.
 *
 * Independently enumerates canonical Postgres transcripts and the active
 * Typesense transcript collection (export for the full id universe, exact
 * per-id reads for vector-bearing comparison), then classifies every
 * transcript as an exact match (ledger-seeded without Typesense import),
 * embedding-owned drift (enqueued through the normal publication path),
 * or lifecycle-only/ambiguous (reported only, never mutated). `dryRun`
 * defaults to `true`; callers must opt in to mutation explicitly.
 */
export async function auditWatchSearchTranscriptCorpus(
  input: WatchSearchTranscriptReconciliationInput,
): Promise<WatchSearchTranscriptReconciliationReport> {
  const now = input.now ?? new Date()
  const dryRun = input.dryRun ?? true
  const { prisma, typesense } = input

  const compatibility =
    await resolveCurrentWatchSearchTranscriptCompatibility(prisma)
  const profile = await freezeCurrentWatchSearchProfile(typesense)
  const transcriptCollection = profile.binding.transcript

  const canonicalTranscripts = await loadCanonicalTranscripts(
    prisma,
    compatibility.contentEmbeddingContractId,
  )
  const canonicalTranscriptIds = new Set(
    canonicalTranscripts.map((transcript) => transcript.transcriptId),
  )
  const allCanonicalIds = new Set(
    canonicalTranscripts.flatMap((transcript) =>
      transcript.documents.map((document) => document.id),
    ),
  )

  const existingDocuments = await typesense.exportDocuments<{ id: string }>(
    transcriptCollection,
    { filterBy: "documentKind:=transcript", includeFields: "id" },
  )
  const existingDocumentIds = new Set(
    existingDocuments.map((document) => document.id),
  )

  const orphanCandidateIds = [...existingDocumentIds].filter(
    (id) => !allCanonicalIds.has(id),
  )
  const chunkOwnerById = await loadChunkOwners(prisma, orphanCandidateIds)
  const unresolvedOrphanIds = orphanCandidateIds.filter(
    (id) => !chunkOwnerById.has(id),
  )
  const historicalOwnerById = await loadHistoricalEventOwners(
    prisma,
    unresolvedOrphanIds,
  )

  const provenExtraIdsByTranscript = new Map<string, string[]>()
  const orphanLifecycleDocumentIds: string[] = []
  const ambiguousExtraDocumentIds: string[] = []
  for (const id of orphanCandidateIds) {
    const chunkOwner = chunkOwnerById.get(id)
    if (chunkOwner) {
      if (canonicalTranscriptIds.has(chunkOwner)) {
        const list = provenExtraIdsByTranscript.get(chunkOwner) ?? []
        list.push(id)
        provenExtraIdsByTranscript.set(chunkOwner, list)
      } else {
        // The chunk row still exists but its transcript is not part of
        // today's active-contract corpus (e.g. a different embedding
        // contract). Cleanup scoped to the active contract cannot safely
        // claim this id, so it fails closed instead of guessing.
        ambiguousExtraDocumentIds.push(id)
      }
      continue
    }
    const historicalOwner = historicalOwnerById.get(id)
    if (historicalOwner) {
      orphanLifecycleDocumentIds.push(id)
      continue
    }
    ambiguousExtraDocumentIds.push(id)
  }

  const existingEvents =
    await prisma.watchSearchCurrentTranscriptPublicationEvent.findMany({
      where: { status: { not: "COMPLETED" } },
      select: {
        id: true,
        transcriptId: true,
        status: true,
        sourceGeneration: true,
      },
    })
  const nonCompletedEventsByTranscript = new Map<
    string,
    NonCompletedEventRow[]
  >()
  for (const event of existingEvents) {
    const list = nonCompletedEventsByTranscript.get(event.transcriptId) ?? []
    list.push(event)
    nonCompletedEventsByTranscript.set(event.transcriptId, list)
  }
  const pendingOrClaimedEventCount = existingEvents.filter(
    (event) => event.status === "PENDING" || event.status === "CLAIMED",
  ).length

  const exactMatchTranscriptIds: string[] = []
  const embeddingDriftTranscriptIds: string[] = []
  const visibilityOnlyDriftTranscriptIds: string[] = []
  const changedDuringAuditTranscriptIds: string[] = []
  const seededTranscriptIds: string[] = []
  const enqueuedPublicationTranscriptIds: string[] = []
  const alreadyRepresentedTranscriptIds: string[] = []

  let establishedProjection: CurrentWatchSearchTranscriptProjection | null =
    null
  const ensureProjection = async () => {
    establishedProjection ??= await ensureProjectionEstablished(prisma, {
      transcriptCollection,
      contentEmbeddingContractId: compatibility.contentEmbeddingContractId,
      transcriptChunkingVersion: compatibility.transcriptChunkingVersion,
    })
    return establishedProjection
  }

  for (const transcript of canonicalTranscripts) {
    const expectedIds = transcript.documents.map((document) => document.id)
    const readableIds = expectedIds.filter((id) => existingDocumentIds.has(id))
    const missingCount = expectedIds.length - readableIds.length

    const readDocuments = await mapWithConcurrency(
      readableIds,
      READBACK_CONCURRENCY,
      (id) =>
        typesense.getDocument<
          TypesenseWatchTranscriptDocument & { embedding?: unknown }
        >(transcriptCollection, id),
    )

    let embeddingDrift = missingCount > 0
    let visibilityOnlyDrift = false
    for (let index = 0; index < readableIds.length; index += 1) {
      const canonicalDoc = normalizeTranscriptDocument(
        transcript.documents.find(
          (document) => document.id === readableIds[index],
        )!,
      )
      const actualRaw = readDocuments[index]
      if (!actualRaw) {
        embeddingDrift = true
        continue
      }
      const actualDoc = normalizeTranscriptDocument({
        ...actualRaw,
        embedding: actualRaw.embedding ?? [],
      })
      if (
        embeddingFieldsDigest(canonicalDoc) !== embeddingFieldsDigest(actualDoc)
      ) {
        embeddingDrift = true
      } else if (
        lifecycleFieldsDigest(canonicalDoc) !== lifecycleFieldsDigest(actualDoc)
      ) {
        visibilityOnlyDrift = true
      }
    }

    const provenExtraIds =
      provenExtraIdsByTranscript.get(transcript.transcriptId) ?? []
    if (provenExtraIds.length > 0) embeddingDrift = true

    if (embeddingDrift) {
      embeddingDriftTranscriptIds.push(transcript.transcriptId)
    } else if (visibilityOnlyDrift) {
      visibilityOnlyDriftTranscriptIds.push(transcript.transcriptId)
    } else {
      exactMatchTranscriptIds.push(transcript.transcriptId)
    }

    if (dryRun) continue

    const reloaded = await reloadTranscriptGeneration(
      prisma,
      transcript.transcriptId,
    )
    if (
      !reloaded ||
      reloaded.sourceGeneration !== transcript.sourceGeneration ||
      reloaded.sourceContentHash !== transcript.sourceContentHash
    ) {
      changedDuringAuditTranscriptIds.push(transcript.transcriptId)
      continue
    }

    const nonCompletedEvents =
      nonCompletedEventsByTranscript.get(transcript.transcriptId) ?? []

    if (!embeddingDrift) {
      if (nonCompletedEvents.length === 0) continue
      const projection = await ensureProjection()
      await prisma.watchSearchCurrentTranscriptPublicationEvent.updateMany({
        where: { id: { in: nonCompletedEvents.map((event) => event.id) } },
        data: {
          status: "COMPLETED",
          leaseTokenHash: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          completedAt: now,
          completedProjectionRevision: projection.projectionRevision,
          updatedAt: now,
        },
      })
      seededTranscriptIds.push(transcript.transcriptId)
      continue
    }

    if (nonCompletedEvents.length > 0) {
      alreadyRepresentedTranscriptIds.push(transcript.transcriptId)
      continue
    }

    try {
      await prisma.watchSearchCurrentTranscriptPublicationEvent.create({
        data: {
          transcriptId: transcript.transcriptId,
          videoId: transcript.videoId,
          videoEditionId: transcript.videoEditionId,
          language: transcript.language,
          contentEmbeddingContractId: compatibility.contentEmbeddingContractId,
          transcriptChunkingVersion: compatibility.transcriptChunkingVersion,
          sourceGeneration: transcript.sourceGeneration,
          sourceContentHash: transcript.sourceContentHash,
          currentDocumentIds: expectedIds,
          staleDocumentIds: provenExtraIds,
        },
      })
      enqueuedPublicationTranscriptIds.push(transcript.transcriptId)
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error
      alreadyRepresentedTranscriptIds.push(transcript.transcriptId)
    }
  }

  const backfillComplete =
    pendingOrClaimedEventCount === 0 && embeddingDriftTranscriptIds.length === 0

  return Object.freeze({
    watermark: now.toISOString(),
    dryRun,
    transcriptCollection,
    contentEmbeddingContractId: compatibility.contentEmbeddingContractId,
    transcriptChunkingVersion: compatibility.transcriptChunkingVersion,
    totalCanonicalTranscripts: canonicalTranscripts.length,
    exactMatchTranscriptIds,
    seededTranscriptIds,
    embeddingDriftTranscriptIds,
    enqueuedPublicationTranscriptIds,
    alreadyRepresentedTranscriptIds,
    visibilityOnlyDriftTranscriptIds,
    changedDuringAuditTranscriptIds,
    orphanLifecycleDocumentIds,
    ambiguousExtraDocumentIds,
    pendingOrClaimedEventCount,
    backfillComplete,
  })
}

export const _internals = {
  chunkArray,
  embeddingFieldsDigest,
  isUniqueConstraintViolation,
  lifecycleFieldsDigest,
  loadChunkOwners,
  loadHistoricalEventOwners,
}
