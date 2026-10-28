import type { Prisma, PrismaClient } from "@prisma/client"
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
    throw new Error("Invalid bounded history page")
  if (
    cursor?.kind === "within" &&
    (!Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 0 ||
      cursor.offset > 514)
  )
    throw new Error("Invalid history cursor")

  const root =
    cursor?.kind === "within"
      ? await prisma.recommendationRequest.findUnique({
          where: { id: cursor.requestId },
          include,
        })
      : await prisma.recommendationRequest.findFirst({
          where: {
            expiresAt: { gt: now },
            ...(cursor ? { id: { gt: cursor.requestId } } : {}),
          },
          orderBy: { id: "asc" },
          include,
        })
  if (!root)
    return cursor?.kind === "within"
      ? {
          events: [],
          cursor: { kind: "after", requestId: cursor.requestId },
          done: false,
        }
      : { events: [], cursor, done: true }
  if (root.expiresAt <= now)
    return {
      events: [],
      cursor: { kind: "after", requestId: root.id },
      done: false,
    }
  if (root.items.length > 64) throw new Error("Served item page exceeds limit")
  const run = root.candidateRun
  if (run && run.stageEvidence.length > 448)
    throw new Error("Candidate trace exceeds stage limit")
  if (
    Buffer.byteLength(
      JSON.stringify({
        servedItemPayload: root.servedItemPayload,
        deliveryDiagnostics: root.deliveryDiagnostics,
        tracePayload: run?.tracePayload,
        stageEvidence: run?.stageEvidence,
      }),
    ) >
    8 * 1_048_576
  )
    throw new Error("Recommendation history root exceeds byte limit")
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
        throw new Error("History event exceeds page byte limit")
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
