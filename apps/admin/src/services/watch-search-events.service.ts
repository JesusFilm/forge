import type { Prisma, PrismaClient, WatchSearchEvent } from "@prisma/client"

export type WatchSearchEventType =
  | "result_clicked"
  | "results_viewed"
  | "load_more"
export type WatchSearchEventClient = "web" | "mobile" | "tv"
export type WatchSearchEventResultType = "video" | "experience"

export type CreateWatchSearchEventInput = {
  requestId: string
  eventType: WatchSearchEventType
  client: WatchSearchEventClient
  resultId?: string | null
  resultType?: WatchSearchEventResultType | null
  position?: number | null
  visibleResultIds?: readonly string[] | null
  routeLanguageSlug?: string | null
  searchLanguageSlug?: string | null
  occurredAt?: string | null
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_VISIBLE_RESULT_IDS = 50
const EVENT_PAST_WINDOW_MS = 24 * 60 * 60 * 1000
const EVENT_FUTURE_WINDOW_MS = 5 * 60 * 1000
const WATCH_SEARCH_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type WatchSearchEventServiceOptions = {
  now?: () => Date
}

export class WatchSearchEventValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchEventValidationError"
  }
}

export class WatchSearchEventService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: WatchSearchEventServiceOptions = {},
  ) {}

  async create(input: CreateWatchSearchEventInput): Promise<WatchSearchEvent> {
    const now = this.options.now?.() ?? new Date()
    const requestId = normalizeRequestId(input.requestId)
    const eventType = normalizeEventType(input.eventType)
    const client = normalizeClient(input.client)
    const resultType = normalizeResultType(input.resultType)
    const resultId = safeToken(input.resultId)
    const position = boundedPositiveInt(input.position)
    const occurredAt = parseOccurredAt(input.occurredAt, now)

    if (eventType === "result_clicked" && !resultId) {
      throw new WatchSearchEventValidationError(
        "result_clicked events require resultId",
      )
    }

    return this.prisma.watchSearchEvent.create({
      data: {
        requestId,
        eventType,
        client,
        resultId,
        resultType,
        position,
        metadata: buildMetadata(input),
        occurredAt,
        expiresAt: new Date(
          occurredAt.getTime() + WATCH_SEARCH_EVENT_RETENTION_MS,
        ),
      },
    })
  }
}

function normalizeRequestId(value: string): string {
  const normalized = value.trim()
  if (!REQUEST_ID_PATTERN.test(normalized)) {
    throw new WatchSearchEventValidationError("Invalid search request id")
  }
  return normalized
}

function normalizeEventType(value: string): WatchSearchEventType {
  if (
    value === "result_clicked" ||
    value === "results_viewed" ||
    value === "load_more"
  ) {
    return value
  }
  throw new WatchSearchEventValidationError("Invalid search event type")
}

function normalizeClient(value: string): WatchSearchEventClient {
  if (value === "web" || value === "mobile" || value === "tv") return value
  throw new WatchSearchEventValidationError("Invalid search event client")
}

function normalizeResultType(
  value: string | null | undefined,
): WatchSearchEventResultType | null {
  if (value == null) return null
  if (value === "video" || value === "experience") return value
  throw new WatchSearchEventValidationError("Invalid search result type")
}

function safeToken(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[\r\n\t]/g, " ").trim()
  if (!normalized || !SAFE_TOKEN_PATTERN.test(normalized)) return null
  return normalized.slice(0, 128)
}

function boundedPositiveInt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(1, Math.floor(value))
}

function parseOccurredAt(value: string | null | undefined, now: Date): Date {
  if (!value) return now
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return now

  const ageMs = now.getTime() - parsed.getTime()
  const futureMs = parsed.getTime() - now.getTime()
  if (ageMs > EVENT_PAST_WINDOW_MS || futureMs > EVENT_FUTURE_WINDOW_MS) {
    throw new WatchSearchEventValidationError(
      "Search event timestamp outside accepted window",
    )
  }

  return parsed
}

function safeVisibleResultIds(
  value: readonly string[] | null | undefined,
): string[] {
  if (!value?.length) return []
  return value
    .flatMap((id) => {
      const safe = safeToken(id)
      return safe ? [safe] : []
    })
    .slice(0, MAX_VISIBLE_RESULT_IDS)
}

function buildMetadata(
  input: CreateWatchSearchEventInput,
): Prisma.InputJsonObject | undefined {
  const metadata: Record<string, Prisma.InputJsonValue> = {
    version: "watch-search-events/v1",
  }
  const visibleResultIds = safeVisibleResultIds(input.visibleResultIds)
  if (visibleResultIds.length > 0) {
    metadata.visibleResultIds = visibleResultIds
  }
  const routeLanguageSlug = safeToken(input.routeLanguageSlug)
  if (routeLanguageSlug) metadata.routeLanguageSlug = routeLanguageSlug
  const searchLanguageSlug = safeToken(input.searchLanguageSlug)
  if (searchLanguageSlug) metadata.searchLanguageSlug = searchLanguageSlug

  return Object.keys(metadata).length > 1
    ? (metadata as Prisma.InputJsonObject)
    : undefined
}
