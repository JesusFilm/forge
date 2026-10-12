import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { videoIdentityDuplicateReason } from "@/services/video-dedup"
import {
  PrecomputedRecommendationError,
  precomputedChoiceSchema,
  validatePrecomputedChoices,
} from "./contract"
import {
  assertPrecomputedObservedVersion,
  selectedTranscriptSelections,
} from "./catalog"
import { verifiedImportedGaCapture } from "./ga-capture-import"

const id = z.string().trim().min(1).max(191)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative().max(2_147_483_647)
const failureCode = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/)
// Exact, owner-reviewed budget2 checkpoint. This is not a general retry path.
const RECOVERY_GENERATION_ID = "subscription-astra-budget2-20261008-v4"
const RECOVERY_ORIGINAL_CALL_ID = "8ab8a620-1608-4115-812e-200bb2fb4b6d"
const RECOVERY_GENERATION_INPUT_DIGEST =
  "36d168040f404b12e12be8d4ecdf8b75c102fe459bcefb22753f434fe29443b9"
const RECOVERY_OLD_ATTEMPT_ID = "6ef8681b-1607-4ae9-b0b1-c28c41225d6b"
const RECOVERY_SOURCE_IDS = [
  "cmokmj8ka0njkqsccfvhbto3g",
  "cmokmjc390nk2qscc79tyun6g",
] as const
const RECOVERY_INPUT_DIGEST =
  "d87ad22523187a6e2bdedbb6a948057fddaa9d18f7a1efe8bb3a3224587a8824"
const RECOVERY_MEMBERSHIP_DIGEST =
  "ec3d4b7ffdfad5bd1ef03d68a5577df2aa6b14969191e9de53b9a0ac8d983b72"
const RECOVERY_CANDIDATE_POOL_DIGEST =
  "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a"
const RECOVERY_CAPTURE_REF_DIGEST =
  "8edf8cce9a1ed5abf1ad847c47dd7f3389a9d1e431f8690ad9b3f0450b3e1cc8"
const provisionalChoice = precomputedChoiceSchema.omit({ rank: true }).extend({
  strength: z.number().int().min(0).max(100),
})
const base = z.object({
  generationId: id,
  generationInputDigest: digest,
  attemptId: z.uuid(),
})
const candidate = z
  .object({
    targetVideoId: id,
    targetProfileKey: digest,
    poolRank: count.max(127),
  })
  .strict()
const member = z
  .object({
    sourceVideoId: id,
    leaseToken: z.uuid(),
    checkpointRevision: count,
    pageIndex: count.max(127),
    sourceProfileKey: digest,
    candidates: z.array(candidate).min(1).max(8),
    candidatePageDigest: digest,
    sourceCandidateCount: count.min(1).max(128),
    sourceCandidateDigest: digest,
    historicalRefDigest: digest,
  })
  .strict()
const spanOffer = z
  .object({
    spanId: z.string().regex(/^[a-f0-9]{32}$/),
    sourceVideoId: id,
    targetVideoId: id,
    videoId: id,
    chunkId: id,
    startChar: count,
    endChar: count,
    textSha256: digest,
  })
  .strict()
const status = z
  .object({
    action: z.literal("edge_batch_status"),
    generationId: id,
    generationInputDigest: digest,
    sourceVideoId: id,
    afterCallId: z.uuid().optional(),
  })
  .strict()
const recoveryAck = base
  .extend({
    action: z.literal("edge_manual_recovery_ack"),
    originalCallId: z.literal(RECOVERY_ORIGINAL_CALL_ID),
    replacementCallId: z.uuid(),
    operatorAccountRef: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
    oldProcessExitedAttested: z.literal(true),
  })
  .strict()
const start = base
  .extend({
    action: z.literal("edge_batch_start"),
    callId: z.uuid(),
    modelId: z.literal("gpt-6-astra"),
    backend: z.literal("codex_chatgpt_subscription"),
    promptVersion: z.string().trim().min(1).max(100),
    schemaVersion: z.string().trim().min(1).max(100),
    inputDigest: digest,
    membershipDigest: digest,
    selectedCorpusDigest: digest,
    candidatePoolDigest: digest,
    captureRefDigest: digest.nullable(),
    spanOfferDigest: digest,
    startedAt: z.string().datetime(),
    members: z.array(member).min(1).max(2),
    spanOffers: z.array(spanOffer).max(64),
  })
  .strict()
const resultChoice = z
  .object({
    targetVideoId: id,
    kind: z.enum(["direct", "alternative"]),
    strength: z.number().int().min(0).max(100),
    relationship: z.string().trim().min(3).max(80),
    reasonEnglish: z.string().trim().min(12).max(600),
    addedViewingValueEnglish: z.string().trim().min(12).max(600).optional(),
    evidence: z.discriminatedUnion("basis", [
      z
        .object({
          basis: z.literal("metadata"),
          fields: z
            .array(
              z.enum([
                "title",
                "description",
                "keywords",
                "themes",
                "bibleCitations",
              ]),
            )
            .min(1)
            .max(5),
        })
        .strict(),
      z
        .object({
          basis: z.literal("transcript"),
          spanIds: z
            .array(z.string().regex(/^[a-f0-9]{32}$/))
            .min(1)
            .max(3),
          passages: z
            .array(
              z
                .object({
                  chunkId: id,
                  excerpt: z.string().trim().min(8).max(240),
                })
                .strict(),
            )
            .min(1)
            .max(3),
        })
        .strict(),
    ]),
  })
  .strict()
const result = z
  .object({
    sourceVideoId: id,
    choices: z.array(resultChoice).max(8),
  })
  .strict()
const resultsSchema = z.array(result).min(1).max(2)
const finish = base
  .extend({
    action: z.literal("edge_batch_finish"),
    callId: z.uuid(),
    inputDigest: digest,
    membershipDigest: digest,
    spanOfferDigest: digest,
    status: z.enum(["succeeded", "rejected", "failed"]),
    outputDigest: digest.optional(),
    results: z.unknown().optional(),
    usage: z
      .object({
        inputTokens: count.positive(),
        outputTokens: count,
        cachedInputTokens: count.optional(),
      })
      .strict(),
    errorCode: failureCode.optional(),
    finishedAt: z.string().datetime(),
  })
  .strict()
const finalize = base
  .extend({
    action: z.literal("edge_source_finalize"),
    sourceVideoId: id,
    leaseToken: z.uuid(),
    expectedRevision: count,
    sourceProfileKey: digest,
    sourceCandidateCount: count.min(1).max(128),
    sourceCandidateDigest: digest,
  })
  .strict()
const closeEmpty = base
  .extend({
    action: z.literal("edge_source_close_empty"),
    sourceVideoId: id,
    leaseToken: z.uuid(),
    expectedRevision: count,
    sourceProfileKey: digest,
    candidatePoolDigest: digest,
    sourceCandidateCount: z.literal(0),
    sourceCandidateDigest: digest,
    historicalRefDigest: digest,
  })
  .strict()
const actionSchema = z.discriminatedUnion("action", [
  status,
  recoveryAck,
  start,
  finish,
  finalize,
  closeEmpty,
])
type Action = z.infer<typeof actionSchema>

type Tx = Prisma.TransactionClient
type Generation = {
  id: string
  status: string
  input_digest: string
  protocol_version: number
  execution_backend: string | null
  model_id: string
  input_mode: string
  input_snapshot_mode: string
  historical_qualification: unknown
  capacity_preflight: unknown
}
type Guards = {
  checkedGeneration: (
    tx: Tx,
    input: { generationId: string; generationInputDigest: string },
    exclusive?: boolean,
  ) => Promise<Generation>
  requireCapacityFresh: (generation: Generation) => void
  capacityIsFresh: (generation: Generation) => boolean
  reserveBudget: (
    tx: Tx,
    generationId: string,
    bytes: number,
  ) => Promise<number>
  saveChoice: (
    tx: Tx,
    generationId: string,
    sourceVideoId: string,
    choice: z.infer<typeof provisionalChoice>,
    reserve?: boolean,
  ) => Promise<boolean>
  hasOpenSubscriptionAttempt: (
    tx: Tx,
    generationId: string,
    attemptId?: string,
  ) => Promise<boolean>
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const hashText = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex")
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8")
const json = (value: unknown) => value as Prisma.InputJsonValue
function invalid(message: string): never {
  throw new PrecomputedRecommendationError("invalid", message)
}
function conflict(message: string): never {
  throw new PrecomputedRecommendationError("conflict", message)
}
async function assertDistinctCandidateContent(
  tx: Tx,
  sourceVideoId: string,
  targetVideoIds: string[],
) {
  const videoIds = [sourceVideoId, ...targetVideoIds]
  const videos = await tx.video.findMany({
    where: { id: { in: videoIds }, deletedAt: null },
    select: {
      id: true,
      coreId: true,
      locales: {
        where: { status: "PUBLISHED", deletedAt: null },
        orderBy: { locale: "asc" },
        select: { locale: true, title: true },
      },
    },
  })
  if (videos.length !== new Set(videoIds).size)
    invalid("Edge source or target Video does not exist")
  const byId = new Map(videos.map((video) => [video.id, video]))
  const relations = await tx.videoRelation.findMany({
    where: { parentId: { in: videoIds }, childId: { in: videoIds } },
    select: { parentId: true, childId: true },
  })
  const pairKey = (a: string, b: string) =>
    JSON.stringify(a < b ? [a, b] : [b, a])
  const relatedPairs = new Set(
    relations.map((relation) => pairKey(relation.parentId, relation.childId)),
  )
  const title = (video: (typeof videos)[number]) =>
    video.locales.find((locale) => locale.locale === "en" && locale.title)
      ?.title ?? video.locales.find((locale) => locale.title)?.title
  const kept = [byId.get(sourceVideoId)!]
  for (const targetVideoId of targetVideoIds) {
    const target = byId.get(targetVideoId)!
    for (const prior of kept) {
      const targetTitle = title(target)
      const priorTitle = title(prior)
      const reason = videoIdentityDuplicateReason(
        { videoCoreId: target.coreId, videoTitle: targetTitle },
        { videoCoreId: prior.coreId, videoTitle: priorTitle },
      )
      if (
        reason &&
        !(
          reason === "core_prefix" &&
          target.coreId !== prior.coreId &&
          targetTitle &&
          priorTitle &&
          targetTitle !== priorTitle &&
          relatedPairs.has(pairKey(target.id, prior.id))
        )
      )
        invalid("Edge candidate is duplicate Video content")
    }
    kept.push(target)
  }
}
function candidatePageDigest(item: z.infer<typeof member>) {
  return hash([
    item.sourceVideoId,
    item.pageIndex,
    item.candidates.map(({ poolRank, targetVideoId, targetProfileKey }) => [
      poolRank,
      targetVideoId,
      targetProfileKey,
    ]),
  ])
}
function scalarBoundary(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return true
  const before = value.charCodeAt(offset - 1)
  const after = value.charCodeAt(offset)
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  )
}
async function offeredExcerpt(
  tx: Tx,
  offer: z.infer<typeof spanOffer>,
  cutoff: Date,
): Promise<string | null> {
  try {
    await assertPrecomputedObservedVersion(tx, [offer.videoId], cutoff)
  } catch {
    return null
  }
  const selected =
    (await selectedTranscriptSelections(tx, [offer.videoId])).get(offer.videoId)
      ?.selected ?? []
  const transcriptIds = new Set(selected.map((item) => item.transcriptId))
  const chunk = await tx.videoTranscriptChunk.findUnique({
    where: { id: offer.chunkId },
    select: {
      transcriptId: true,
      transcript: { select: { videoId: true } },
      rawSourceText: true,
      text: true,
    },
  })
  if (
    !chunk ||
    chunk.transcript.videoId !== offer.videoId ||
    !transcriptIds.has(chunk.transcriptId)
  )
    return null
  const text = chunk.rawSourceText ?? chunk.text
  if (
    offer.endChar <= offer.startChar ||
    offer.endChar > text.length ||
    !scalarBoundary(text, offer.startChar) ||
    !scalarBoundary(text, offer.endChar)
  )
    return null
  const excerpt = text.slice(offer.startChar, offer.endChar)
  return excerpt === excerpt.trim() &&
    excerpt.length >= 8 &&
    excerpt.length <= 240 &&
    hashText(excerpt) === offer.textSha256
    ? excerpt
    : null
}
async function validateSpanOffers(
  tx: Tx,
  input: z.infer<typeof start>,
  cutoff: Date,
) {
  const memberBySource = new Map(
    input.members.map((item) => [item.sourceVideoId, item]),
  )
  const seen = new Set<string>()
  const pairCounts = new Map<string, number>()
  for (const offer of input.spanOffers) {
    const item = memberBySource.get(offer.sourceVideoId)
    const pair = JSON.stringify([offer.sourceVideoId, offer.targetVideoId])
    const expectedId = hash([
      input.generationInputDigest,
      cutoff.toISOString(),
      input.callId,
      offer.sourceVideoId,
      offer.targetVideoId,
      offer.videoId,
      offer.chunkId,
      offer.startChar,
      offer.endChar,
      offer.textSha256,
    ]).slice(0, 32)
    if (
      seen.has(offer.spanId) ||
      offer.spanId !== expectedId ||
      !item?.candidates.some(
        (candidate) => candidate.targetVideoId === offer.targetVideoId,
      ) ||
      ![offer.sourceVideoId, offer.targetVideoId].includes(offer.videoId) ||
      (pairCounts.get(pair) ?? 0) >= 8 ||
      !(await offeredExcerpt(tx, offer, cutoff))
    )
      invalid("Edge span offer is not an exact selected passage")
    seen.add(offer.spanId)
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1)
  }
}
function publicMembers(
  members: Array<{
    sourceVideoId: string
    applicationState: string
    appliedRevision: number | null
    checkpointRevision: number
  }>,
) {
  return members.map((item) => ({
    sourceVideoId: item.sourceVideoId,
    applicationState: item.applicationState,
    appliedRevision: item.appliedRevision,
    checkpointRevision: item.appliedRevision ?? item.checkpointRevision,
  }))
}

async function replacementReconciled(
  tx: Tx,
  generationId: string,
  replacementCallId: string | null,
): Promise<boolean> {
  if (!replacementCallId) return false
  const replacement =
    await tx.recommendationPrecomputedEdgeBatchCall.findUnique({
      where: {
        generationId_callId: { generationId, callId: replacementCallId },
      },
      include: {
        members: { orderBy: { sourceVideoId: "asc" } },
        executionAttempt: { select: { endedAt: true } },
      },
    })
  return Boolean(
    replacement &&
    replacement.status === "succeeded" &&
    replacement.inputTokens !== null &&
    replacement.outputTokens !== null &&
    replacement.receiptDigest !== null &&
    replacement.executionAttempt.endedAt !== null &&
    replacement.members.length === RECOVERY_SOURCE_IDS.length &&
    replacement.members.every(
      (item, index) =>
        item.sourceVideoId === RECOVERY_SOURCE_IDS[index] &&
        ["applied_edges", "applied_empty"].includes(item.applicationState),
    ),
  )
}

export async function submitEdgeAction(
  prisma: PrismaClient,
  raw: unknown,
  guards: Guards,
): Promise<Record<string, unknown>> {
  if (bytes(raw) > 65_536) invalid("Edge action body exceeds 64 KiB")
  const parsed = actionSchema.safeParse(raw)
  if (!parsed.success) invalid("Invalid edge action")
  const input: Action = parsed.data
  return prisma.$transaction(
    async (tx) => {
      const generation = await guards.checkedGeneration(
        tx,
        input,
        input.action === "edge_manual_recovery_ack" ||
          input.action === "edge_batch_start",
      )
      if (
        generation.protocol_version !== 4 ||
        generation.execution_backend !== "codex_chatgpt_subscription" ||
        generation.model_id !== "gpt-6-astra"
      )
        throw new PrecomputedRecommendationError(
          "conflict",
          "Generation does not use the edge protocol",
        )
      if (input.action === "edge_batch_status") {
        const source = await tx.recommendationPrecomputedBuildSource.findUnique(
          {
            where: {
              generationId_sourceVideoId: {
                generationId: input.generationId,
                sourceVideoId: input.sourceVideoId,
              },
            },
            select: {
              state: true,
              checkpointRevision: true,
              edgeSourceCandidateCount: true,
              edgeSourceCandidateDigest: true,
            },
          },
        )
        if (!source)
          throw new PrecomputedRecommendationError(
            "not_found",
            "Source is outside the frozen manifest",
          )
        if (
          input.afterCallId &&
          !(await tx.recommendationPrecomputedEdgeBatchMember.findUnique({
            where: {
              generationId_callId_sourceVideoId: {
                generationId: input.generationId,
                callId: input.afterCallId,
                sourceVideoId: input.sourceVideoId,
              },
            },
            select: { callId: true },
          }))
        )
          invalid("Edge status cursor is unknown")
        const members =
          await tx.recommendationPrecomputedEdgeBatchMember.findMany({
            where: {
              generationId: input.generationId,
              sourceVideoId: input.sourceVideoId,
            },
            include: {
              call: {
                select: {
                  attemptId: true,
                  status: true,
                  startedAt: true,
                  finishedAt: true,
                  recoveryReplacementCallId: true,
                  members: {
                    orderBy: { sourceVideoId: "asc" },
                    select: { sourceVideoId: true },
                  },
                },
              },
            },
            orderBy: [{ pageIndex: "asc" }, { callId: "asc" }],
            ...(input.afterCallId
              ? {
                  cursor: {
                    generationId_callId_sourceVideoId: {
                      generationId: input.generationId,
                      callId: input.afterCallId,
                      sourceVideoId: input.sourceVideoId,
                    },
                  },
                  skip: 1,
                }
              : {}),
            take: 65,
          })
        const page = members.slice(0, 64)
        const nextCursor = members.length > 64 ? page.at(-1)!.callId : null
        const reconciled = new Map<string, boolean>()
        for (const item of page) {
          const replacementCallId = item.call.recoveryReplacementCallId
          if (replacementCallId && !reconciled.has(replacementCallId))
            reconciled.set(
              replacementCallId,
              await replacementReconciled(
                tx,
                input.generationId,
                replacementCallId,
              ),
            )
        }
        return {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
          sourceState: source.state,
          checkpointRevision: source.checkpointRevision,
          sourceCandidateCount: source.edgeSourceCandidateCount,
          sourceCandidateDigest: source.edgeSourceCandidateDigest,
          nextCursor,
          calls: page.map((item) => ({
            callId: item.callId,
            attemptId: item.call.attemptId,
            status: item.call.status,
            applicationState: item.applicationState,
            pageIndex: item.pageIndex,
            candidatePageDigest: item.candidatePageDigest,
            candidates: z.array(candidate).parse(item.candidates),
            appliedRevision: item.appliedRevision,
            startedAt: item.call.startedAt.toISOString(),
            finishedAt: item.call.finishedAt?.toISOString() ?? null,
            recoveryReplacementCallId:
              item.call.recoveryReplacementCallId ?? null,
            recoveryReconciled: item.call.recoveryReplacementCallId
              ? (reconciled.get(item.call.recoveryReplacementCallId) ?? false)
              : false,
            memberSourceVideoIds: item.call.members.map(
              (member) => member.sourceVideoId,
            ),
          })),
        }
      }
      if (input.action === "edge_manual_recovery_ack")
        return acknowledgeManualRecovery(tx, input, generation, guards)
      if (input.action === "edge_batch_start")
        return startEdgeBatch(tx, input, generation, guards)
      if (input.action === "edge_source_finalize")
        return finalizeEdgeSource(tx, input, generation, guards)
      if (input.action === "edge_source_close_empty")
        return closeEmptyEdgeSource(tx, input, generation, guards)
      return finishEdgeBatch(tx, input, generation, guards)
    },
    { timeout: 30_000 },
  )
}

async function acknowledgeManualRecovery(
  tx: Tx,
  input: z.infer<typeof recoveryAck>,
  generation: Generation,
  guards: Guards,
): Promise<Record<string, unknown>> {
  if (
    input.generationId !== RECOVERY_GENERATION_ID ||
    input.generationInputDigest !== RECOVERY_GENERATION_INPUT_DIGEST ||
    input.attemptId === RECOVERY_OLD_ATTEMPT_ID ||
    input.replacementCallId === RECOVERY_ORIGINAL_CALL_ID ||
    generation.status !== "incomplete"
  )
    conflict("Manual recovery scope differs from the reviewed checkpoint")
  guards.requireCapacityFresh(generation)
  const newAttempt =
    await tx.recommendationPrecomputedExecutionAttempt.findUnique({
      where: {
        generationId_attemptId: {
          generationId: input.generationId,
          attemptId: input.attemptId,
        },
      },
    })
  if (
    !newAttempt ||
    newAttempt.endedAt ||
    newAttempt.accountRef !== input.operatorAccountRef ||
    newAttempt.billingBasis !== "included_subscription" ||
    newAttempt.backend !== "codex_chatgpt_subscription" ||
    newAttempt.modelId !== "gpt-6-astra"
  )
    conflict("Manual recovery requires the active operator attempt")
  if (
    (await tx.recommendationPrecomputedExecutionAttempt.count({
      where: { generationId: input.generationId, endedAt: null },
    })) !== 1
  )
    conflict("Manual recovery requires one active operator attempt")
  await tx.$queryRaw`
    SELECT call_id FROM recommendation_precomputed_edge_batch_call
    WHERE generation_id = ${input.generationId}
      AND call_id = ${input.originalCallId}::uuid FOR UPDATE`
  const original = await tx.recommendationPrecomputedEdgeBatchCall.findUnique({
    where: {
      generationId_callId: {
        generationId: input.generationId,
        callId: input.originalCallId,
      },
    },
    include: { members: { orderBy: { sourceVideoId: "asc" } } },
  })
  if (
    !original ||
    original.attemptId !== RECOVERY_OLD_ATTEMPT_ID ||
    original.status !== "pending" ||
    original.inputDigest !== RECOVERY_INPUT_DIGEST ||
    original.membershipDigest !== RECOVERY_MEMBERSHIP_DIGEST ||
    original.candidatePoolDigest !== RECOVERY_CANDIDATE_POOL_DIGEST ||
    original.captureRefDigest !== RECOVERY_CAPTURE_REF_DIGEST ||
    original.inputTokens !== null ||
    original.outputTokens !== null ||
    original.cachedInputTokens !== null ||
    original.finishedAt !== null ||
    original.receiptDigest !== null ||
    original.members.length !== RECOVERY_SOURCE_IDS.length ||
    original.members.some((item, index) => {
      const parsed = z.array(candidate).safeParse(item.candidates)
      return (
        item.sourceVideoId !== RECOVERY_SOURCE_IDS[index] ||
        item.pageIndex !== 0 ||
        !parsed.success ||
        parsed.data.length !== 4 ||
        parsed.data.some((candidate, rank) => candidate.poolRank !== rank) ||
        item.candidatePageDigest !==
          hash([
            item.sourceVideoId,
            item.pageIndex,
            parsed.data.map((candidate) => [
              candidate.poolRank,
              candidate.targetVideoId,
              candidate.targetProfileKey,
            ]),
          ])
      )
    })
  )
    conflict("Original unresolved edge reservation differs")
  if (original.recoveryReplacementCallId !== null) {
    if (
      original.recoveryReplacementCallId !== input.replacementCallId ||
      original.recoveryOperatorAccountRef !== input.operatorAccountRef ||
      !original.recoveryOldProcessExitedAttested ||
      original.members.some(
        (item) => item.applicationState !== "acknowledged_unknown",
      )
    )
      conflict("Manual recovery acknowledgment differs")
    return {
      generationId: input.generationId,
      originalCallId: input.originalCallId,
      replacementCallId: input.replacementCallId,
      state: "acknowledged_unknown",
      replay: true,
    }
  }
  const oldAttempt =
    await tx.recommendationPrecomputedExecutionAttempt.findUnique({
      where: {
        generationId_attemptId: {
          generationId: input.generationId,
          attemptId: RECOVERY_OLD_ATTEMPT_ID,
        },
      },
      select: { endedAt: true },
    })
  if (!oldAttempt?.endedAt)
    conflict("Original subscription attempt remains active")
  if (
    (await tx.recommendationPrecomputedEdgeBatchCall.count({
      where: { generationId: input.generationId },
    })) !== 1 ||
    (await tx.recommendationPrecomputedProfileCall.count({
      where: { generationId: input.generationId, status: "pending" },
    })) !== 0 ||
    original.members.some((item) => item.applicationState !== "pending") ||
    (await tx.recommendationPrecomputedBuildSource.count({
      where: {
        generationId: input.generationId,
        state: "claimed",
        leaseExpiresAt: { gt: new Date() },
      },
    })) !== 0
  )
    conflict("Manual recovery requires one unresolved call and no live leases")
  const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
    where: { id: input.generationId },
  })
  const binding = await verifiedImportedGaCapture(tx, meta)
  if (
    !binding ||
    binding.bindingDigest !== RECOVERY_CAPTURE_REF_DIGEST ||
    binding.destination.candidatePoolDigest !== RECOVERY_CANDIDATE_POOL_DIGEST
  )
    conflict("Historical recovery capture identity differs")
  const sources = await tx.recommendationPrecomputedBuildSource.findMany({
    where: {
      generationId: input.generationId,
      sourceVideoId: { in: [...RECOVERY_SOURCE_IDS] },
    },
    orderBy: { sourceVideoId: "asc" },
  })
  if (
    sources.length !== RECOVERY_SOURCE_IDS.length ||
    sources.some((source, index) => {
      const member = original.members[index]!
      return (
        source.sourceVideoId !== member.sourceVideoId ||
        source.state !== "claimed" ||
        (source.leaseExpiresAt !== null &&
          source.leaseExpiresAt > new Date()) ||
        source.checkpointRevision !== member.checkpointRevision ||
        source.edgeSourceCandidateCount !== member.sourceCandidateCount ||
        source.edgeSourceCandidateDigest !== member.sourceCandidateDigest ||
        source.edgeSourceProfileKey !== member.sourceProfileKey ||
        source.edgeCandidatePoolDigest !== RECOVERY_CANDIDATE_POOL_DIGEST ||
        source.edgeHistoricalRefDigest !== member.historicalRefDigest ||
        source.historicalProvenance === null
      )
    })
  )
    conflict("Recovered source or historical identity differs")
  const profileKeys = [
    ...original.members.flatMap((item) => [
      item.sourceProfileKey,
      ...(item.candidates as z.infer<typeof candidate>[]).map(
        (candidate) => candidate.targetProfileKey,
      ),
    ]),
  ]
  const profiles = await tx.recommendationPrecomputedContentProfile.findMany({
    where: {
      generationId: input.generationId,
      cacheKey: { in: [...new Set(profileKeys)] },
      state: "ready",
    },
    select: { cacheKey: true, videoId: true },
  })
  const byProfileKey = new Map(
    profiles.map((profile) => [profile.cacheKey, profile.videoId]),
  )
  if (
    profiles.length !== new Set(profileKeys).size ||
    original.members.some(
      (item) =>
        byProfileKey.get(item.sourceProfileKey) !== item.sourceVideoId ||
        (item.candidates as z.infer<typeof candidate>[]).some(
          (candidate) =>
            byProfileKey.get(candidate.targetProfileKey) !==
            candidate.targetVideoId,
        ),
    )
  )
    conflict("Recovered content profiles are not ready")
  await guards.reserveBudget(tx, input.generationId, 512)
  await tx.recommendationPrecomputedEdgeBatchCall.update({
    where: {
      generationId_callId: {
        generationId: input.generationId,
        callId: input.originalCallId,
      },
    },
    data: {
      recoveryReplacementCallId: input.replacementCallId,
      recoveryOperatorAccountRef: input.operatorAccountRef,
      recoveryAcknowledgedAt: new Date(),
      recoveryOldProcessExitedAttested: true,
    },
  })
  await tx.recommendationPrecomputedEdgeBatchMember.updateMany({
    where: {
      generationId: input.generationId,
      callId: input.originalCallId,
      applicationState: "pending",
    },
    data: { applicationState: "acknowledged_unknown" },
  })
  return {
    generationId: input.generationId,
    originalCallId: input.originalCallId,
    replacementCallId: input.replacementCallId,
    state: "acknowledged_unknown",
    replay: false,
  }
}

async function startEdgeBatch(
  tx: Tx,
  input: z.infer<typeof start>,
  generation: Generation,
  guards: Guards,
): Promise<Record<string, unknown>> {
  if (generation.status !== "incomplete") conflict("Generation is closed")
  if (
    !(await guards.hasOpenSubscriptionAttempt(
      tx,
      input.generationId,
      input.attemptId,
    ))
  )
    conflict("Subscription attempt is inactive")
  guards.requireCapacityFresh(generation)
  const acknowledged =
    await tx.recommendationPrecomputedEdgeBatchCall.findFirst({
      where: {
        generationId: input.generationId,
        recoveryReplacementCallId: { not: null },
      },
      include: { members: { orderBy: { sourceVideoId: "asc" } } },
    })
  if (acknowledged) {
    if (
      input.generationId !== RECOVERY_GENERATION_ID ||
      acknowledged.callId !== RECOVERY_ORIGINAL_CALL_ID ||
      !acknowledged.recoveryReplacementCallId ||
      acknowledged.members.some(
        (item) => item.applicationState !== "acknowledged_unknown",
      )
    )
      conflict("Manual recovery acknowledgment differs")
    if (input.callId === acknowledged.recoveryReplacementCallId) {
      if (
        input.members.length !== RECOVERY_SOURCE_IDS.length ||
        input.members.some((item, index) => {
          const original = acknowledged.members[index]
          const originalCandidates = z
            .array(candidate)
            .safeParse(original?.candidates)
          return (
            !original ||
            !originalCandidates.success ||
            item.sourceVideoId !== RECOVERY_SOURCE_IDS[index] ||
            item.sourceVideoId !== original.sourceVideoId ||
            item.pageIndex !== 0 ||
            item.pageIndex !== original.pageIndex ||
            item.sourceProfileKey !== original.sourceProfileKey ||
            item.candidatePageDigest !== original.candidatePageDigest ||
            item.sourceCandidateCount !== original.sourceCandidateCount ||
            item.sourceCandidateDigest !== original.sourceCandidateDigest ||
            item.historicalRefDigest !== original.historicalRefDigest ||
            item.candidates.length !== originalCandidates.data.length ||
            item.candidates.some(
              (offered, candidateIndex) =>
                offered.poolRank !==
                  originalCandidates.data[candidateIndex]?.poolRank ||
                offered.targetVideoId !==
                  originalCandidates.data[candidateIndex]?.targetVideoId ||
                offered.targetProfileKey !==
                  originalCandidates.data[candidateIndex]?.targetProfileKey,
            )
          )
        }) ||
        input.candidatePoolDigest !== acknowledged.candidatePoolDigest ||
        input.selectedCorpusDigest !== acknowledged.selectedCorpusDigest ||
        input.captureRefDigest !== acknowledged.captureRefDigest
      )
        conflict("Replacement edge reservation differs from original page")
    } else {
      if (
        !(await replacementReconciled(
          tx,
          input.generationId,
          acknowledged.recoveryReplacementCallId,
        ))
      )
        conflict("Replacement edge receipt has not safely applied")
      if (
        (await tx.recommendationPrecomputedEdgeBatchCall.count({
          where: {
            generationId: input.generationId,
            status: "pending",
            callId: { not: RECOVERY_ORIGINAL_CALL_ID },
          },
        })) !== 0
      )
        conflict("Another unknown edge call remains pending")
    }
  }
  if (
    generation.input_mode === "content_only" &&
    input.captureRefDigest !== null
  )
    invalid("Content-only edge call cannot claim historical capture")
  if (generation.input_mode === "historical_analytics") {
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      {
        where: { id: input.generationId },
      },
    )
    const binding = await verifiedImportedGaCapture(tx, meta)
    if (
      !binding ||
      input.captureRefDigest !== binding.bindingDigest ||
      input.candidatePoolDigest !== binding.destination.candidatePoolDigest
    )
      conflict("Historical edge call lacks verified GA import")
  }
  if (
    hash(input.members.map(({ leaseToken: _leaseToken, ...item }) => item)) !==
    input.membershipDigest
  )
    invalid("Edge membership digest differs")
  if (hash(input.spanOffers) !== input.spanOfferDigest)
    invalid("Edge span-offer digest differs")
  if (input.members.reduce((sum, item) => sum + item.candidates.length, 0) > 16)
    invalid("Too many offered source-target slots")
  const sourceIds = input.members.map((item) => item.sourceVideoId)
  if (
    sourceIds.some((item, index) => index > 0 && item <= sourceIds[index - 1]!)
  )
    invalid("Edge members must have unique sorted sources")
  const cutoff = (
    await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
      where: { id: input.generationId },
      select: { inputCutoff: true },
    })
  ).inputCutoff
  await validateSpanOffers(tx, input, cutoff)
  const previous = await tx.recommendationPrecomputedEdgeBatchCall.findUnique({
    where: {
      generationId_callId: {
        generationId: input.generationId,
        callId: input.callId,
      },
    },
    include: { members: { orderBy: { sourceVideoId: "asc" } } },
  })
  const requestDigest = hash(input)
  if (previous) {
    if (previous.requestDigest !== requestDigest)
      conflict("Edge reservation retry differs")
    return {
      generationId: input.generationId,
      callId: input.callId,
      state: previous.status,
      replay: true,
      members: publicMembers(previous.members),
    }
  }
  const sources = await tx.$queryRaw<
    Array<{
      source_video_id: string
      state: string
      lease_token: string | null
      lease_expires_at: Date | null
      checkpoint_revision: number
    }>
  >`
    SELECT source_video_id, state, lease_token, lease_expires_at, checkpoint_revision
    FROM recommendation_precomputed_build_source
    WHERE generation_id = ${input.generationId}
      AND source_video_id IN (${Prisma.join(sourceIds)})
    ORDER BY source_video_id FOR UPDATE`
  if (sources.length !== input.members.length)
    conflict("Edge source is outside the frozen manifest")
  const concurrent = await tx.recommendationPrecomputedEdgeBatchCall.findUnique(
    {
      where: {
        generationId_callId: {
          generationId: input.generationId,
          callId: input.callId,
        },
      },
      include: { members: { orderBy: { sourceVideoId: "asc" } } },
    },
  )
  if (concurrent) {
    if (concurrent.requestDigest !== requestDigest)
      conflict("Edge reservation retry differs")
    return {
      generationId: input.generationId,
      callId: input.callId,
      state: concurrent.status,
      replay: true,
      members: publicMembers(concurrent.members),
    }
  }
  const bySource = new Map(sources.map((row) => [row.source_video_id, row]))
  for (const item of input.members) {
    const source = bySource.get(item.sourceVideoId)
    if (
      !source ||
      source.state !== "claimed" ||
      source.lease_token !== item.leaseToken ||
      !source.lease_expires_at ||
      source.lease_expires_at <= new Date() ||
      source.checkpoint_revision !== item.checkpointRevision
    )
      conflict("Edge source lease or checkpoint is stale")
    if (candidatePageDigest(item) !== item.candidatePageDigest)
      invalid("Edge candidate page digest differs")
    const ranks = item.candidates.map((candidate) => candidate.poolRank)
    if (
      item.candidates.some(
        (candidate) => candidate.targetVideoId === item.sourceVideoId,
      ) ||
      new Set(item.candidates.map((candidate) => candidate.targetVideoId))
        .size !== item.candidates.length ||
      ranks.some(
        (rank, index) => index > 0 && rank !== ranks[index - 1]! + 1,
      ) ||
      ranks.at(-1)! >= item.sourceCandidateCount
    )
      invalid("Edge candidate page is not a unique contiguous rank slice")
    const sourceProfile =
      await tx.recommendationPrecomputedContentProfile.findUnique({
        where: {
          generationId_cacheKey: {
            generationId: input.generationId,
            cacheKey: item.sourceProfileKey,
          },
        },
        select: { videoId: true, state: true },
      })
    if (
      sourceProfile?.videoId !== item.sourceVideoId ||
      sourceProfile.state !== "ready"
    )
      conflict("Edge source profile is not ready")
    const frozen =
      await tx.recommendationPrecomputedBuildSource.findUniqueOrThrow({
        where: {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: item.sourceVideoId,
          },
        },
        select: {
          edgeSourceCandidateCount: true,
          edgeSourceCandidateDigest: true,
          edgeSourceProfileKey: true,
          edgeCandidatePoolDigest: true,
          edgeHistoricalRefDigest: true,
          historicalProvenance: true,
        },
      })
    if (
      generation.input_mode === "historical_analytics" &&
      !frozen.historicalProvenance
    )
      conflict("Historical edge source lacks imported provenance")
    if (frozen.edgeSourceCandidateCount === null) {
      await tx.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: input.generationId,
            sourceVideoId: item.sourceVideoId,
          },
        },
        data: {
          edgeSourceCandidateCount: item.sourceCandidateCount,
          edgeSourceCandidateDigest: item.sourceCandidateDigest,
          edgeSourceProfileKey: item.sourceProfileKey,
          edgeCandidatePoolDigest: input.candidatePoolDigest,
          edgeHistoricalRefDigest: item.historicalRefDigest,
        },
      })
    } else if (
      frozen.edgeSourceCandidateCount !== item.sourceCandidateCount ||
      frozen.edgeSourceCandidateDigest !== item.sourceCandidateDigest ||
      frozen.edgeSourceProfileKey !== item.sourceProfileKey ||
      frozen.edgeCandidatePoolDigest !== input.candidatePoolDigest ||
      frozen.edgeHistoricalRefDigest !== item.historicalRefDigest
    )
      conflict("Edge source candidate identity differs from frozen pool")
    for (const candidate of item.candidates) {
      const targetProfile =
        await tx.recommendationPrecomputedContentProfile.findUnique({
          where: {
            generationId_cacheKey: {
              generationId: input.generationId,
              cacheKey: candidate.targetProfileKey,
            },
          },
          select: { videoId: true, state: true },
        })
      if (
        targetProfile?.videoId !== candidate.targetVideoId ||
        targetProfile.state !== "ready"
      )
        conflict("Edge target profile is not ready")
    }
    const prior = await tx.recommendationPrecomputedEdgeBatchMember.findMany({
      where: {
        generationId: input.generationId,
        sourceVideoId: item.sourceVideoId,
      },
      orderBy: [{ pageIndex: "asc" }, { callId: "asc" }],
      include: {
        call: {
          select: { candidatePoolDigest: true, selectedCorpusDigest: true },
        },
      },
    })
    if (prior.length >= 512) conflict("Edge source call history limit reached")
    if (prior.some((row) => row.applicationState === "pending"))
      conflict("Unknown edge call consumption remains pending")
    if (
      prior.some(
        (row) =>
          row.sourceCandidateCount !== item.sourceCandidateCount ||
          row.sourceCandidateDigest !== item.sourceCandidateDigest ||
          row.sourceProfileKey !== item.sourceProfileKey ||
          row.historicalRefDigest !== item.historicalRefDigest ||
          row.call.candidatePoolDigest !== input.candidatePoolDigest ||
          row.call.selectedCorpusDigest !== input.selectedCorpusDigest,
      )
    )
      conflict("Edge source candidate identity differs across pages")
    const applied = prior.filter((row) =>
      ["applied_edges", "applied_empty"].includes(row.applicationState),
    )
    const priorRanks = applied
      .flatMap((row) =>
        (row.candidates as z.infer<typeof candidate>[]).map(
          (candidate) => candidate.poolRank,
        ),
      )
      .sort((a, b) => a - b)
    const priorTargets = new Set(
      applied.flatMap((row) =>
        (row.candidates as z.infer<typeof candidate>[]).map(
          (candidate) => candidate.targetVideoId,
        ),
      ),
    )
    if (
      item.candidates.some((candidate) =>
        priorTargets.has(candidate.targetVideoId),
      )
    )
      conflict("Edge page repeats a prior target")
    await assertDistinctCandidateContent(tx, item.sourceVideoId, [
      ...priorTargets,
      ...item.candidates.map((candidate) => candidate.targetVideoId),
    ])
    if (
      item.pageIndex !== applied.length ||
      ranks[0] !== priorRanks.length ||
      priorRanks.some((rank, index) => rank !== index)
    )
      conflict("Edge page does not continue applied rank coverage")
  }
  await guards.reserveBudget(tx, input.generationId, 192_000)
  await tx.recommendationPrecomputedEdgeBatchCall.create({
    data: {
      generationId: input.generationId,
      callId: input.callId,
      attemptId: input.attemptId,
      modelId: input.modelId,
      backend: input.backend,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      inputDigest: input.inputDigest,
      membershipDigest: input.membershipDigest,
      selectedCorpusDigest: input.selectedCorpusDigest,
      candidatePoolDigest: input.candidatePoolDigest,
      captureRefDigest: input.captureRefDigest,
      spanOfferDigest: input.spanOfferDigest,
      spanOffers: json(input.spanOffers),
      requestDigest,
      startedAt: new Date(input.startedAt),
      status: "pending",
    },
  })
  await tx.recommendationPrecomputedEdgeBatchMember.createMany({
    data: input.members.map((item) => ({
      generationId: input.generationId,
      callId: input.callId,
      sourceVideoId: item.sourceVideoId,
      leaseToken: item.leaseToken,
      checkpointRevision: item.checkpointRevision,
      pageIndex: item.pageIndex,
      sourceProfileKey: item.sourceProfileKey,
      candidates: json(item.candidates),
      candidatePageDigest: item.candidatePageDigest,
      sourceCandidateCount: item.sourceCandidateCount,
      sourceCandidateDigest: item.sourceCandidateDigest,
      historicalRefDigest: item.historicalRefDigest,
      applicationState: "pending",
    })),
  })
  return {
    generationId: input.generationId,
    callId: input.callId,
    state: "pending",
    replay: false,
    members: input.members.map((item) => ({
      sourceVideoId: item.sourceVideoId,
      applicationState: "pending",
      appliedRevision: null,
      checkpointRevision: item.checkpointRevision,
    })),
  }
}

async function validateMetadataEvidence(
  tx: Tx,
  sourceVideoId: string,
  targetVideoId: string,
  fields: Array<
    "title" | "description" | "keywords" | "themes" | "bibleCitations"
  >,
) {
  if (new Set(fields).size !== fields.length || fields.includes("themes"))
    return false
  const videos = await tx.video.findMany({
    where: { id: { in: [sourceVideoId, targetVideoId] } },
    select: {
      locales: {
        where: { status: "PUBLISHED", deletedAt: null },
        select: { title: true, description: true, snippet: true },
      },
      keywords: { select: { keyword: { select: { value: true } } }, take: 1 },
      bibleCitations: { select: { osisId: true }, take: 1 },
    },
  })
  if (videos.length !== 2) return false
  return fields.every((field) =>
    videos.some((video) =>
      field === "title"
        ? video.locales.some((locale) => Boolean(locale.title?.trim()))
        : field === "description"
          ? video.locales.some((locale) =>
              Boolean((locale.description ?? locale.snippet)?.trim()),
            )
          : field === "keywords"
            ? video.keywords.some((item) => Boolean(item.keyword.value?.trim()))
            : video.bibleCitations.some((item) => Boolean(item.osisId?.trim())),
    ),
  )
}

async function checkedResults(
  tx: Tx,
  input: z.infer<typeof finish>,
  offers: z.infer<typeof spanOffer>[],
  cutoff: Date,
  members: Array<{
    sourceVideoId: string
    candidates: Prisma.JsonValue
  }>,
): Promise<{
  results: z.infer<typeof resultsSchema>
  choices: Map<string, z.infer<typeof provisionalChoice>[]>
} | null> {
  const parsed = resultsSchema.safeParse(input.results)
  if (
    input.status !== "succeeded" ||
    input.errorCode !== undefined ||
    !parsed.success ||
    !input.outputDigest ||
    hash(parsed.success ? parsed.data : null) !== input.outputDigest ||
    parsed.data.length !== members.length
  )
    return null
  const results = parsed.data
  const choices = new Map<string, z.infer<typeof provisionalChoice>[]>()
  for (let i = 0; i < members.length; i++) {
    const item = members[i]!
    const result = results[i]!
    if (result.sourceVideoId !== item.sourceVideoId) return null
    const offered = new Set(
      (item.candidates as z.infer<typeof candidate>[]).map(
        (candidate) => candidate.targetVideoId,
      ),
    )
    if (
      result.choices.length > offered.size ||
      new Set(result.choices.map((choice) => choice.targetVideoId)).size !==
        result.choices.length ||
      result.choices.some((choice) => !offered.has(choice.targetVideoId))
    )
      return null
    const normalized: z.infer<typeof provisionalChoice>[] = []
    for (const choice of result.choices) {
      if (choice.evidence.basis === "metadata") {
        if (
          !(await validateMetadataEvidence(
            tx,
            item.sourceVideoId,
            choice.targetVideoId,
            choice.evidence.fields,
          ))
        )
          return null
        normalized.push(provisionalChoice.parse(choice))
      } else {
        const evidence = choice.evidence
        if (
          evidence.spanIds.length !== evidence.passages.length ||
          new Set(evidence.spanIds).size !== evidence.spanIds.length
        )
          return null
        for (let j = 0; j < evidence.spanIds.length; j++) {
          const offer = offers.find(
            (item) => item.spanId === evidence.spanIds[j],
          )
          const passage = evidence.passages[j]!
          if (
            !offer ||
            offer.sourceVideoId !== result.sourceVideoId ||
            offer.targetVideoId !== choice.targetVideoId ||
            offer.chunkId !== passage.chunkId ||
            (await offeredExcerpt(tx, offer, cutoff)) !== passage.excerpt
          )
            return null
        }
        normalized.push(
          provisionalChoice.parse({
            ...choice,
            evidence: {
              basis: "transcript",
              passages: choice.evidence.passages,
            },
          }),
        )
      }
    }
    choices.set(item.sourceVideoId, normalized)
  }
  return { results, choices }
}

async function finishEdgeBatch(
  tx: Tx,
  input: z.infer<typeof finish>,
  generation: Generation,
  guards: Guards,
): Promise<Record<string, unknown>> {
  const observed = await tx.recommendationPrecomputedEdgeBatchCall.findUnique({
    where: {
      generationId_callId: {
        generationId: input.generationId,
        callId: input.callId,
      },
    },
    select: {
      members: {
        orderBy: { sourceVideoId: "asc" },
        select: { sourceVideoId: true },
      },
    },
  })
  if (!observed?.members.length)
    conflict("Edge receipt has no matching reservation")
  const sourceIds = observed.members.map((item) => item.sourceVideoId)
  const sources = await tx.$queryRaw<
    Array<{
      source_video_id: string
      state: string
      lease_token: string | null
      lease_expires_at: Date | null
      checkpoint_revision: number
    }>
  >`
    SELECT source_video_id, state, lease_token, lease_expires_at, checkpoint_revision
    FROM recommendation_precomputed_build_source
    WHERE generation_id = ${input.generationId}
      AND source_video_id IN (${Prisma.join(sourceIds)})
    ORDER BY source_video_id FOR UPDATE`
  await tx.$queryRaw`
    SELECT call_id FROM recommendation_precomputed_edge_batch_call
    WHERE generation_id = ${input.generationId} AND call_id = ${input.callId}::uuid
    FOR UPDATE`
  const call = await tx.recommendationPrecomputedEdgeBatchCall.findUnique({
    where: {
      generationId_callId: {
        generationId: input.generationId,
        callId: input.callId,
      },
    },
    include: { members: { orderBy: { sourceVideoId: "asc" } } },
  })
  if (
    !call ||
    call.attemptId !== input.attemptId ||
    call.inputDigest !== input.inputDigest ||
    call.membershipDigest !== input.membershipDigest ||
    call.spanOfferDigest !== input.spanOfferDigest
  )
    conflict("Edge receipt has no matching reservation")
  if (call.recoveryReplacementCallId !== null)
    conflict("Acknowledged unknown edge call cannot apply a late receipt")
  const receiptDigest = hash(input)
  if (call.status !== "pending") {
    if (call.receiptDigest !== receiptDigest)
      conflict("Edge terminal receipt differs")
    return {
      generationId: input.generationId,
      callId: input.callId,
      state: call.status,
      receiptStored: true,
      replay: true,
      members: publicMembers(call.members),
    }
  }
  if (new Date(input.finishedAt).getTime() < call.startedAt.getTime())
    invalid("Edge call finish predates reservation")
  let valid: Awaited<ReturnType<typeof checkedResults>> = null
  let malformedReceipt = false
  if (input.status === "succeeded") {
    const cutoff = (
      await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
        where: { id: input.generationId },
        select: { inputCutoff: true },
      })
    ).inputCutoff
    const offers = z.array(spanOffer).parse(call.spanOffers)
    valid = await checkedResults(tx, input, offers, cutoff, call.members)
  } else if (
    input.outputDigest !== undefined ||
    input.results !== undefined ||
    !input.errorCode
  )
    malformedReceipt = true
  const status =
    malformedReceipt || (input.status === "succeeded" && !valid)
      ? "rejected"
      : input.status
  const errorCode = malformedReceipt
    ? "edge_receipt_invalid"
    : input.status === "succeeded" && !valid
      ? "edge_output_invalid"
      : (input.errorCode ?? null)
  await tx.recommendationPrecomputedEdgeBatchCall.update({
    where: {
      generationId_callId: {
        generationId: input.generationId,
        callId: input.callId,
      },
    },
    data: {
      status,
      outputDigest: status === "succeeded" ? input.outputDigest : null,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cachedInputTokens: input.usage.cachedInputTokens ?? null,
      errorCode,
      finishedAt: new Date(input.finishedAt),
      receiptDigest,
    },
  })
  const bySource = new Map(sources.map((row) => [row.source_video_id, row]))
  const active =
    generation.status === "incomplete" &&
    guards.capacityIsFresh(generation) &&
    (await guards.hasOpenSubscriptionAttempt(
      tx,
      input.generationId,
      input.attemptId,
    ))
  for (const item of call.members) {
    const source = bySource.get(item.sourceVideoId)
    const current = Boolean(
      active &&
      source &&
      source.state === "claimed" &&
      source.lease_token === item.leaseToken &&
      source.lease_expires_at &&
      source.lease_expires_at > new Date() &&
      source.checkpoint_revision === item.checkpointRevision,
    )
    let applicationState =
      status !== "succeeded"
        ? "rejected_unapplied"
        : current
          ? valid?.choices.get(item.sourceVideoId)?.length
            ? "applied_edges"
            : "applied_empty"
          : "stale_unapplied"
    let appliedRevision: number | null = null
    if (status === "succeeded" && current && source && valid) {
      const choices = valid.choices.get(item.sourceVideoId) ?? []
      const existingChoices =
        await tx.recommendationPrecomputedBuildChoice.findMany({
          where: {
            generationId: input.generationId,
            sourceVideoId: item.sourceVideoId,
          },
          select: { targetVideoId: true },
        })
      if (
        choices.some((choice) =>
          existingChoices.some(
            (prior) => prior.targetVideoId === choice.targetVideoId,
          ),
        )
      ) {
        applicationState = "rejected_unapplied"
      } else {
        for (const choice of choices)
          await guards.saveChoice(
            tx,
            input.generationId,
            item.sourceVideoId,
            choice,
            false,
          )
        const endRank =
          Math.max(
            ...(item.candidates as z.infer<typeof candidate>[]).map(
              (candidate) => candidate.poolRank,
            ),
          ) + 1
        const checkpoint = {
          stage: "edge_page_applied_v1",
          cursor: { candidateIndex: endRank },
        }
        appliedRevision = source.checkpoint_revision + 1
        await tx.recommendationPrecomputedBuildSource.update({
          where: {
            generationId_sourceVideoId: {
              generationId: input.generationId,
              sourceVideoId: item.sourceVideoId,
            },
          },
          data: {
            checkpointRevision: appliedRevision,
            checkpointId: input.callId,
            checkpointDigest: hash(checkpoint),
            checkpoint: json(checkpoint),
          },
        })
      }
    }
    await tx.recommendationPrecomputedEdgeBatchMember.update({
      where: {
        generationId_callId_sourceVideoId: {
          generationId: input.generationId,
          callId: input.callId,
          sourceVideoId: item.sourceVideoId,
        },
      },
      data: {
        applicationState,
        appliedRevision,
        resultChoiceCount:
          status === "succeeded"
            ? (valid?.choices.get(item.sourceVideoId)?.length ?? null)
            : null,
      },
    })
  }
  const members = await tx.recommendationPrecomputedEdgeBatchMember.findMany({
    where: { generationId: input.generationId, callId: input.callId },
    orderBy: { sourceVideoId: "asc" },
  })
  return {
    generationId: input.generationId,
    callId: input.callId,
    state: status,
    receiptStored: true,
    replay: false,
    members: publicMembers(members),
  }
}

async function finalizeEdgeSource(
  tx: Tx,
  input: z.infer<typeof finalize>,
  generation: Generation,
  guards: Guards,
): Promise<Record<string, unknown>> {
  if (generation.status !== "incomplete") conflict("Generation is closed")
  if (
    !(await guards.hasOpenSubscriptionAttempt(
      tx,
      input.generationId,
      input.attemptId,
    ))
  )
    conflict("Subscription attempt is inactive")
  guards.requireCapacityFresh(generation)
  const locked = await tx.$queryRaw<
    Array<{
      state: string
      lease_token: string | null
      lease_expires_at: Date | null
      checkpoint_revision: number
    }>
  >`
    SELECT state, lease_token, lease_expires_at, checkpoint_revision
    FROM recommendation_precomputed_build_source
    WHERE generation_id = ${input.generationId} AND source_video_id = ${input.sourceVideoId}
    FOR UPDATE`
  const row = locked[0]
  if (!row) conflict("Edge source is outside the frozen manifest")
  const source =
    await tx.recommendationPrecomputedBuildSource.findUniqueOrThrow({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
    })
  if (generation.input_mode === "historical_analytics") {
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      {
        where: { id: input.generationId },
      },
    )
    const binding = await verifiedImportedGaCapture(tx, meta)
    if (
      !binding ||
      !source.historicalProvenance ||
      source.edgeCandidatePoolDigest !== binding.destination.candidatePoolDigest
    )
      conflict("Historical edge source lacks verified GA import")
  }
  if (
    source.edgeSourceCandidateCount !== input.sourceCandidateCount ||
    source.edgeSourceCandidateDigest !== input.sourceCandidateDigest ||
    source.edgeSourceProfileKey !== input.sourceProfileKey
  )
    conflict("Edge source identity differs from frozen pool")
  if (["complete_edges", "complete_empty"].includes(row.state)) {
    const final = await tx.recommendationPrecomputedSource.findUniqueOrThrow({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
    })
    return {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
      sourceState: row.state,
      acceptedCount: final.acceptedCount,
      checkpointRevision: row.checkpoint_revision,
      replay: true,
    }
  }
  if (
    row.state !== "claimed" ||
    row.lease_token !== input.leaseToken ||
    !row.lease_expires_at ||
    row.lease_expires_at <= new Date() ||
    row.checkpoint_revision !== input.expectedRevision
  )
    conflict("Edge source lease or checkpoint is stale")
  const profile = await tx.recommendationPrecomputedContentProfile.findUnique({
    where: {
      generationId_cacheKey: {
        generationId: input.generationId,
        cacheKey: input.sourceProfileKey,
      },
    },
    select: { videoId: true, state: true },
  })
  if (profile?.videoId !== input.sourceVideoId || profile.state !== "ready")
    conflict("Edge source profile is not ready")
  const members = await tx.recommendationPrecomputedEdgeBatchMember.findMany({
    where: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
    },
    orderBy: [{ pageIndex: "asc" }, { callId: "asc" }],
    include: { call: { select: { status: true } } },
  })
  if (members.some((item) => item.applicationState === "pending"))
    conflict("Unknown edge call consumption remains pending")
  for (const item of members.filter(
    (member) => member.applicationState === "acknowledged_unknown",
  )) {
    const original =
      await tx.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
        where: {
          generationId_callId: {
            generationId: input.generationId,
            callId: item.callId,
          },
        },
        select: { recoveryReplacementCallId: true },
      })
    if (
      item.callId !== RECOVERY_ORIGINAL_CALL_ID ||
      !(await replacementReconciled(
        tx,
        input.generationId,
        original.recoveryReplacementCallId,
      ))
    )
      conflict("Replacement edge receipt has not safely applied")
  }
  const applied = members.filter((item) =>
    ["applied_edges", "applied_empty"].includes(item.applicationState),
  )
  const orderedCandidates = applied.flatMap(
    (item) => item.candidates as z.infer<typeof candidate>[],
  )
  if (
    applied.some(
      (item, index) =>
        item.pageIndex !== index || item.call.status !== "succeeded",
    ) ||
    orderedCandidates.length !== input.sourceCandidateCount ||
    orderedCandidates.some((item, index) => item.poolRank !== index) ||
    new Set(orderedCandidates.map((item) => item.targetVideoId)).size !==
      orderedCandidates.length ||
    hash(orderedCandidates.map((item) => item.targetVideoId)) !==
      input.sourceCandidateDigest ||
    applied.at(-1)?.appliedRevision !== row.checkpoint_revision
  )
    conflict("Edge source candidate pages are incomplete")
  const offeredTargets = new Set(
    orderedCandidates.map((item) => item.targetVideoId),
  )
  const provisional = await tx.recommendationPrecomputedBuildChoice.findMany({
    where: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
    },
  })
  const parsed = provisional.map((item) =>
    provisionalChoice.parse(item.payload),
  )
  if (parsed.some((item) => !offeredTargets.has(item.targetVideoId)))
    conflict("Edge choice was not in the frozen candidate pool")
  const ordered = parsed.sort((a, b) =>
    a.kind === b.kind
      ? b.strength - a.strength ||
        a.targetVideoId.localeCompare(b.targetVideoId)
      : a.kind === "direct"
        ? -1
        : 1,
  )
  const ranks = { direct: 0, alternative: 0 }
  const choices = ordered.map(({ strength: _strength, ...item }) => ({
    ...item,
    rank: ++ranks[item.kind],
  }))
  const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow({
    where: { id: input.generationId },
    select: { inputCutoff: true },
  })
  await assertPrecomputedObservedVersion(
    tx,
    [input.sourceVideoId, ...choices.map((item) => item.targetVideoId)],
    meta.inputCutoff,
  )
  const payload = await validatePrecomputedChoices(
    tx,
    input.sourceVideoId,
    choices,
  )
  await guards.reserveBudget(tx, input.generationId, bytes(payload) + 256)
  await tx.recommendationPrecomputedSource.create({
    data: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
      payload: json(payload),
      submissionDigest: hash(choices),
      acceptedCount: payload.length,
      status: "complete",
    },
  })
  await tx.recommendationPrecomputedBuildChoice.deleteMany({
    where: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
    },
  })
  const sourceState = payload.length ? "complete_edges" : "complete_empty"
  await tx.recommendationPrecomputedBuildSource.update({
    where: {
      generationId_sourceVideoId: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    },
    data: {
      state: sourceState,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
      checkpoint: {},
      checkpointId: null,
      checkpointDigest: null,
    },
  })
  return {
    generationId: input.generationId,
    sourceVideoId: input.sourceVideoId,
    sourceState,
    acceptedCount: payload.length,
    checkpointRevision: row.checkpoint_revision,
    replay: false,
  }
}

async function closeEmptyEdgeSource(
  tx: Tx,
  input: z.infer<typeof closeEmpty>,
  generation: Generation,
  guards: Guards,
): Promise<Record<string, unknown>> {
  if (generation.status !== "incomplete") conflict("Generation is closed")
  if (
    !(await guards.hasOpenSubscriptionAttempt(
      tx,
      input.generationId,
      input.attemptId,
    ))
  )
    conflict("Subscription attempt is inactive")
  guards.requireCapacityFresh(generation)
  if (input.sourceCandidateDigest !== hash([]))
    invalid("Empty source candidate digest differs")
  const locked = await tx.$queryRaw<
    Array<{
      state: string
      lease_token: string | null
      lease_expires_at: Date | null
      checkpoint_revision: number
    }>
  >`
    SELECT state, lease_token, lease_expires_at, checkpoint_revision
    FROM recommendation_precomputed_build_source
    WHERE generation_id = ${input.generationId} AND source_video_id = ${input.sourceVideoId}
    FOR UPDATE`
  const row = locked[0]
  if (!row) conflict("Edge source is outside the frozen manifest")
  const source =
    await tx.recommendationPrecomputedBuildSource.findUniqueOrThrow({
      where: {
        generationId_sourceVideoId: {
          generationId: input.generationId,
          sourceVideoId: input.sourceVideoId,
        },
      },
    })
  if (generation.input_mode === "historical_analytics") {
    const meta = await tx.recommendationPrecomputedGeneration.findUniqueOrThrow(
      {
        where: { id: input.generationId },
      },
    )
    const binding = await verifiedImportedGaCapture(tx, meta)
    if (
      !binding ||
      !source.historicalProvenance ||
      input.candidatePoolDigest !== binding.destination.candidatePoolDigest
    )
      conflict("Historical edge source lacks verified GA import")
  }
  if (
    source.edgeSourceCandidateCount !== null &&
    (source.edgeSourceCandidateCount !== 0 ||
      source.edgeSourceCandidateDigest !== input.sourceCandidateDigest ||
      source.edgeSourceProfileKey !== input.sourceProfileKey ||
      source.edgeCandidatePoolDigest !== input.candidatePoolDigest ||
      source.edgeHistoricalRefDigest !== input.historicalRefDigest)
  )
    conflict("Empty source identity differs from frozen pool")
  if (row.state === "complete_empty" && source.edgeSourceCandidateCount === 0)
    return {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
      sourceState: "complete_empty",
      acceptedCount: 0,
      checkpointRevision: row.checkpoint_revision,
      replay: true,
    }
  if (
    row.state !== "claimed" ||
    row.lease_token !== input.leaseToken ||
    !row.lease_expires_at ||
    row.lease_expires_at <= new Date() ||
    row.checkpoint_revision !== input.expectedRevision
  )
    conflict("Empty source lease or checkpoint is stale")
  const profile = await tx.recommendationPrecomputedContentProfile.findUnique({
    where: {
      generationId_cacheKey: {
        generationId: input.generationId,
        cacheKey: input.sourceProfileKey,
      },
    },
    select: { videoId: true, state: true },
  })
  if (profile?.videoId !== input.sourceVideoId || profile.state !== "ready")
    conflict("Empty source profile is not ready")
  const callCount = await tx.recommendationPrecomputedEdgeBatchMember.count({
    where: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
    },
  })
  if (callCount) conflict("Empty source already has reserved candidate pages")
  const choices = await tx.recommendationPrecomputedBuildChoice.count({
    where: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
    },
  })
  if (choices) conflict("Empty source already has provisional choices")
  const payload = await validatePrecomputedChoices(tx, input.sourceVideoId, [])
  await guards.reserveBudget(tx, input.generationId, 1_024)
  await tx.recommendationPrecomputedSource.create({
    data: {
      generationId: input.generationId,
      sourceVideoId: input.sourceVideoId,
      payload: json(payload),
      submissionDigest: hash([]),
      acceptedCount: 0,
      status: "complete",
    },
  })
  await tx.recommendationPrecomputedBuildSource.update({
    where: {
      generationId_sourceVideoId: {
        generationId: input.generationId,
        sourceVideoId: input.sourceVideoId,
      },
    },
    data: {
      state: "complete_empty",
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
      checkpoint: {},
      checkpointId: null,
      checkpointDigest: null,
      edgeSourceCandidateCount: 0,
      edgeSourceCandidateDigest: input.sourceCandidateDigest,
      edgeSourceProfileKey: input.sourceProfileKey,
      edgeCandidatePoolDigest: input.candidatePoolDigest,
      edgeHistoricalRefDigest: input.historicalRefDigest,
    },
  })
  return {
    generationId: input.generationId,
    sourceVideoId: input.sourceVideoId,
    sourceState: "complete_empty",
    acceptedCount: 0,
    checkpointRevision: row.checkpoint_revision,
    replay: false,
  }
}
