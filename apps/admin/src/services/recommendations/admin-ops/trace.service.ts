import {
  Prisma,
  RecommendationAuditKind,
  RecommendationEpisodeState,
  RecommendationRequestState,
  type PrismaClient,
} from "@prisma/client"
import {
  RECOMMENDATION_TRACE_MAX_CURSOR_LENGTH,
  RECOMMENDATION_TRACE_PAGE_SIZE,
  boundedRecommendationIdentifier,
  firstRecommendationSearchParam,
  resolveRecommendationOpsWindow,
  resolveRecommendationTraceFilters,
  type RecommendationOpsWindow,
  type RecommendationTraceFilters,
} from "./shared"

type TraceCursor = Readonly<{ createdAt: Date; id: string }>

export type RecommendationTraceRow = Readonly<{
  id: string
  state: "prepared" | "issued" | "issuance_failed"
  result: "served" | "fallback" | "empty" | "unavailable"
  fallbackReason: string | null
  strategyVersion: string
  classifierVersion: string
  locale: string
  expectedItemCount: number
  retrievalLatencyMs: number | null
  responseBytes: number | null
  createdAt: Date
  issuedAt: Date | null
  counts: Readonly<{
    items: number
    rendered: number
    impressions: number
    selections: number
    episodes: number
    outcomes: number
    conflicts: number
  }>
}>

export type RecommendationTracePageData = Readonly<{
  window: RecommendationOpsWindow
  filters: RecommendationTraceFilters
  rows: RecommendationTraceRow[]
  nextCursor: string | null
}>

export async function loadRecommendationTracePage(
  prisma: PrismaClient,
  input: {
    window?: string | string[]
    requestState?: string | string[]
    fallbackReason?: string | string[]
    evidenceState?: string | string[]
    cursor?: string | string[]
    now?: Date
  } = {},
): Promise<RecommendationTracePageData> {
  const now = input.now ?? new Date()
  const window = resolveRecommendationOpsWindow(input.window, now)
  const filters = resolveRecommendationTraceFilters(input)
  const cursor = decodeTraceCursor(firstRecommendationSearchParam(input.cursor))
  const where: Prisma.RecommendationRequestWhereInput = {
    createdAt: { gte: window.start, lt: window.end },
    expiresAt: { gt: now },
    ...(filters.requestState
      ? { state: requestStateByFilter[filters.requestState] }
      : {}),
    ...(filters.fallbackReason
      ? { fallbackReason: filters.fallbackReason }
      : {}),
    ...evidenceWhere(filters.evidenceState, now),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  }
  const rows = await prisma.recommendationRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECOMMENDATION_TRACE_PAGE_SIZE + 1,
    select: {
      id: true,
      state: true,
      result: true,
      fallbackReason: true,
      strategyVersion: true,
      classifierVersion: true,
      locale: true,
      expectedItemCount: true,
      retrievalLatencyMs: true,
      responseBytes: true,
      createdAt: true,
      issuedAt: true,
      _count: {
        select: {
          items: true,
          renderedFacts: true,
          impressions: true,
          selections: true,
          episodes: true,
          outcomes: true,
          conflicts: true,
        },
      },
    },
  })
  const pageRows = rows.slice(0, RECOMMENDATION_TRACE_PAGE_SIZE)
  const last = pageRows.at(-1)
  return {
    window,
    filters,
    rows: pageRows.map((row) => ({
      id: row.id,
      state: row.state.toLowerCase() as RecommendationTraceRow["state"],
      result: row.result.toLowerCase() as RecommendationTraceRow["result"],
      fallbackReason: row.fallbackReason,
      strategyVersion: row.strategyVersion,
      classifierVersion: row.classifierVersion,
      locale: row.locale,
      expectedItemCount: row.expectedItemCount,
      retrievalLatencyMs: row.retrievalLatencyMs,
      responseBytes: row.responseBytes,
      createdAt: row.createdAt,
      issuedAt: row.issuedAt,
      counts: {
        items: row._count.items,
        rendered: row._count.renderedFacts,
        impressions: row._count.impressions,
        selections: row._count.selections,
        episodes: row._count.episodes,
        outcomes: row._count.outcomes,
        conflicts: row._count.conflicts,
      },
    })),
    nextCursor:
      rows.length > RECOMMENDATION_TRACE_PAGE_SIZE && last
        ? encodeTraceCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  }
}

const requestStateByFilter = {
  prepared: RecommendationRequestState.PREPARED,
  issued: RecommendationRequestState.ISSUED,
  issuance_failed: RecommendationRequestState.ISSUANCE_FAILED,
} as const

function evidenceWhere(
  state: RecommendationTraceFilters["evidenceState"],
  now: Date,
): Prisma.RecommendationRequestWhereInput {
  if (state === "loss_suspected") {
    return {
      audits: {
        some: {
          kind: {
            in: [
              RecommendationAuditKind.COMMITTED_REJECTION,
              RecommendationAuditKind.WRITE_FAILURE,
            ],
          },
        },
      },
    }
  }
  if (state === "replay") {
    return { audits: { some: { kind: RecommendationAuditKind.REPLAY } } }
  }
  if (state === "conflict") return { conflicts: { some: {} } }
  if (state === "late") return { playbackFacts: { some: { late: true } } }
  if (state === "classifier_lag") {
    return {
      episodes: {
        some: {
          outcomes: { none: {} },
          OR: [
            {
              facts: {
                some: {
                  kind: { in: ["playback_end", "playback_error"] },
                },
              },
            },
            {
              state: {
                in: [
                  RecommendationEpisodeState.PENDING,
                  RecommendationEpisodeState.CLAIMED,
                ],
              },
              activeUntil: { lte: now },
            },
          ],
        },
      },
    }
  }
  return {}
}

function encodeTraceCursor(cursor: TraceCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString("base64url")
}

function decodeTraceCursor(value: string | undefined): TraceCursor | null {
  if (!value || value.length > RECOMMENDATION_TRACE_MAX_CURSOR_LENGTH)
    return null
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      typeof parsed !== "object" ||
      parsed == null ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !boundedRecommendationIdentifier.test(parsed.id)
    ) {
      return null
    }
    const createdAt = new Date(parsed.createdAt)
    if (!Number.isFinite(createdAt.getTime())) return null
    return { createdAt, id: parsed.id }
  } catch {
    return null
  }
}
