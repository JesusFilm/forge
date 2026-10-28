import { Prisma, type PrismaClient } from "@prisma/client"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import type { RecommendationEventEnvelope } from "./envelope"
import {
  candidateRunHistoryEvent,
  requestHistoryEvent,
  servedItemHistoryEvent,
  stageHistoryEvent,
  storedCandidateStageRows,
} from "./trace-codec"

export type RecommendationTraceBackfillCursor =
  | Readonly<{ kind: "after"; requestId: string }>
  | Readonly<{ kind: "within"; requestId: string; offset: number }>

const include = {
  items: { orderBy: [{ position: "asc" }, { id: "asc" }], take: 65 },
  candidateRun: {
    include: {
      stageEvidence: {
        orderBy: [{ stage: "asc" }, { ordinal: "asc" }, { id: "asc" }],
        take: 449,
      },
    },
  },
} satisfies Prisma.RecommendationRequestInclude

const ROOT_BYTE_LIMIT = 8 * 1_048_576

type RootSize = {
  requestBytes: bigint
  runBytes: bigint
  itemCount: bigint
  itemBytes: bigint
  stageCount: bigint
  stageBytes: bigint
}

/** One bounded request root per read. The returned cursor is caller-checkpointed. */
export async function readRecommendationTraceHistoryPage(
  prisma: PrismaClient,
  cursor: RecommendationTraceBackfillCursor | null,
  options: { now?: Date; maxEvents?: number; maxBytes?: number } = {},
): Promise<{
  events: RecommendationEventEnvelope[]
  cursor: RecommendationTraceBackfillCursor | null
  done: boolean
}> {
  const now = options.now ?? new Date()
  const maxEvents = options.maxEvents ?? 100
  const maxBytes = options.maxBytes ?? 1_048_576
  if (
    !Number.isSafeInteger(maxEvents) ||
    maxEvents < 1 ||
    maxEvents > 100 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1_048_576
  )
    throw new RecommendationInputError("Invalid bounded history page")
  if (
    cursor?.kind === "within" &&
    (!Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 0 ||
      cursor.offset > 514)
  )
    throw new RecommendationInputError("Invalid history cursor")

  // Size every SQL row, including legacy item JSON, before Prisma transfers
  // any payload. Preflight and hydration share the same repeatable-read view.
  const lookup = await prisma.$transaction(
    async (tx) => {
      const candidate =
        cursor?.kind === "within"
          ? await tx.recommendationRequest.findUnique({
              where: { id: cursor.requestId },
              select: { id: true, expiresAt: true },
            })
          : await tx.recommendationRequest.findFirst({
              where: {
                expiresAt: { gt: now },
                ...(cursor ? { id: { gt: cursor.requestId } } : {}),
              },
              orderBy: { id: "asc" },
              select: { id: true, expiresAt: true },
            })
      if (!candidate || candidate.expiresAt <= now)
        return { kind: "unavailable" as const, candidate }
      const [size] = await tx.$queryRaw<RootSize[]>`
        SELECT
          octet_length(row_to_json(r)::text)::bigint AS "requestBytes",
          coalesce(octet_length(row_to_json(cr)::text), 0)::bigint AS "runBytes",
          i.item_count AS "itemCount",
          i.item_bytes AS "itemBytes",
          s.stage_count AS "stageCount",
          s.stage_bytes AS "stageBytes"
        FROM recommendation_request r
        LEFT JOIN recommendation_candidate_run cr ON cr.request_id = r.id
        CROSS JOIN LATERAL (
          SELECT count(*)::bigint AS item_count,
            coalesce(sum(octet_length(row_to_json(si)::text)), 0)::bigint AS item_bytes
          FROM recommendation_served_item si WHERE si.request_id = r.id
        ) i
        CROSS JOIN LATERAL (
          SELECT count(*)::bigint AS stage_count,
            coalesce(sum(octet_length(row_to_json(se)::text)), 0)::bigint AS stage_bytes
          FROM recommendation_candidate_stage_evidence se WHERE se.run_id = cr.id
        ) s
        WHERE r.id = ${candidate.id}
      `
      if (!size)
        throw new RecommendationInternalStateError("history_root_changed")
      if (size.itemCount > 64n)
        throw new RecommendationInternalStateError("history_item_limit")
      if (size.stageCount > 448n)
        throw new RecommendationInternalStateError("history_stage_limit")
      if (
        size.requestBytes + size.runBytes + size.itemBytes + size.stageBytes >
        BigInt(ROOT_BYTE_LIMIT)
      )
        throw new RecommendationInternalStateError("history_root_byte_limit")
      const root = await tx.recommendationRequest.findUnique({
        where: { id: candidate.id },
        include,
      })
      if (!root)
        throw new RecommendationInternalStateError("history_root_changed")
      return { kind: "ready" as const, root }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 2_000,
      timeout: 10_000,
    },
  )
  if (lookup.kind === "unavailable") {
    if (!lookup.candidate)
      return cursor?.kind === "within"
        ? {
            events: [],
            cursor: { kind: "after", requestId: cursor.requestId },
            done: false,
          }
        : { events: [], cursor, done: true }
    return {
      events: [],
      cursor: { kind: "after", requestId: lookup.candidate.id },
      done: false,
    }
  }
  const root = lookup.root
  if (root.items.length > 64)
    throw new RecommendationInternalStateError("history_item_limit")
  const run = root.candidateRun
  if (run && run.stageEvidence.length > 448)
    throw new RecommendationInternalStateError("history_stage_limit")
  if (Buffer.byteLength(JSON.stringify(root)) > ROOT_BYTE_LIMIT)
    throw new RecommendationInternalStateError("history_root_byte_limit")
  const stages = run ? storedCandidateStageRows(run, run.stageEvidence) : []
  stages.sort(
    (a, b) =>
      (a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : 0) ||
      a.ordinal - b.ordinal ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const total = 1 + root.items.length + (run ? 1 + stages.length : 0)
  let offset = cursor?.kind === "within" ? cursor.offset : 0
  if (offset >= total)
    return {
      events: [],
      cursor: { kind: "after", requestId: root.id },
      done: false,
    }
  const events: RecommendationEventEnvelope[] = []
  let bytes = 0
  while (offset < total && events.length < maxEvents) {
    const event =
      offset === 0
        ? requestHistoryEvent(root)
        : offset <= root.items.length
          ? servedItemHistoryEvent(root, root.items[offset - 1]!)
          : offset === root.items.length + 1 && run
            ? candidateRunHistoryEvent(run)
            : stageHistoryEvent(
                root.id,
                stages[offset - root.items.length - (run ? 2 : 1)]!,
              )
    const size = Buffer.byteLength(JSON.stringify(event))
    if (bytes + size > maxBytes) {
      if (events.length === 0)
        throw new RecommendationInternalStateError(
          "history_event_page_byte_limit",
        )
      break
    }
    events.push(event)
    bytes += size
    offset++
  }
  return {
    events,
    cursor:
      offset < total
        ? { kind: "within", requestId: root.id, offset }
        : { kind: "after", requestId: root.id },
    done: false,
  }
}
