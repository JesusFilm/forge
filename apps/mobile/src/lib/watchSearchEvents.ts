/**
 * First-party admin search events (feat-334): pure variable builders plus
 * fire-and-forget senders for RESULT_CLICKED / RESULTS_VIEWED as client MOBILE.
 * Sanitization ports web's search-actions.ts; anonymous by design (KTD6).
 */
import { type AdminVariablesOf } from "@forge/admin-graphql"

import { getApolloClient } from "./apolloClient"
import { RECORD_WATCH_SEARCH_EVENT } from "./queries"
import { SEARCH_LANGUAGE_SLUG } from "./watchSearch"

type RecordWatchSearchEventVariables = AdminVariablesOf<
  typeof RECORD_WATCH_SEARCH_EVENT
>

// Admin truncates visibleResultIds at 50 (MAX_VISIBLE_RESULT_IDS); capping
// client-side keeps payloads bounded instead of shipping ids admin will drop.
const MAX_VISIBLE_RESULT_IDS = 50

export type RecordResultClickedInput = {
  requestId: string | null | undefined
  resultId: string
  /** Mobile's SearchResult.type is a plain string; unknown values map to VIDEO. */
  resultType: string
  position: number
  visibleResultIds: readonly string[]
}

export type RecordResultsViewedInput = {
  requestId: string | null | undefined
  visibleResultIds: readonly string[]
}

// Admin's event path THROWS on an id failing this shape (unlike the search
// path, which substitutes a fresh UUID) — sending one guarantees a failed
// mutation, so builders refuse it up front.
function safeRequestId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || !/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) return null
  return normalized
}

function safeToken(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[\r\n\t]/g, " ").trim()
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    return null
  }
  return normalized.slice(0, 128)
}

function safePositiveInt(value: number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.floor(parsed)
}

function safeVisibleResultIds(value: readonly string[]): string[] {
  return value
    .flatMap((id) => {
      const safe = safeToken(id)
      return safe ? [safe] : []
    })
    .slice(0, MAX_VISIBLE_RESULT_IDS)
}

// Mobile's SearchResult.type carries admin's UPPERCASE enum ("EXPERIENCE"),
// unlike web's lowercase SearchContentType — normalize so both map correctly.
function toWatchSearchEventResultType(type: string): "VIDEO" | "EXPERIENCE" {
  return type.toUpperCase() === "EXPERIENCE" ? "EXPERIENCE" : "VIDEO"
}

export function buildResultClickedVariables(
  input: RecordResultClickedInput,
): RecordWatchSearchEventVariables | null {
  const requestId = safeRequestId(input.requestId)
  // Admin rejects result_clicked without a resultId, so an unsendable id
  // makes the whole event unsendable.
  const resultId = safeToken(input.resultId)
  if (!requestId || !resultId) return null
  return {
    requestId,
    eventType: "RESULT_CLICKED",
    client: "MOBILE",
    resultId,
    resultType: toWatchSearchEventResultType(input.resultType),
    position: safePositiveInt(input.position),
    visibleResultIds: safeVisibleResultIds(input.visibleResultIds),
    // Mobile never sends routeLanguageSlug on the search request; reporting
    // one here would fabricate a request field (buildWatchSearchInput).
    routeLanguageSlug: null,
    searchLanguageSlug: SEARCH_LANGUAGE_SLUG,
  } satisfies RecordWatchSearchEventVariables
}

export function buildResultsViewedVariables(
  input: RecordResultsViewedInput,
): RecordWatchSearchEventVariables | null {
  const requestId = safeRequestId(input.requestId)
  const visibleResultIds = safeVisibleResultIds(input.visibleResultIds)
  // Admin would accept a zero-id row, but it inflates the CTR denominator;
  // web guards client-side for the same reason.
  if (!requestId || visibleResultIds.length === 0) return null
  return {
    requestId,
    eventType: "RESULTS_VIEWED",
    client: "MOBILE",
    resultId: null,
    resultType: null,
    position: null,
    visibleResultIds,
    routeLanguageSlug: null,
    searchLanguageSlug: SEARCH_LANGUAGE_SLUG,
  } satisfies RecordWatchSearchEventVariables
}

/** Fire-and-forget: resolves void on every path and never rejects. */
export async function recordResultClicked(
  input: RecordResultClickedInput,
): Promise<void> {
  try {
    const variables = buildResultClickedVariables(input)
    if (!variables) return
    await mutateEvent(variables)
  } catch {
    // Swallow everything, incl. a SYNC getter throw (fire-and-forget
    // sync-throw law): shed/failed events are the designed outcome (KTD6).
  }
}

/** Fire-and-forget: resolves void on every path and never rejects. */
export async function recordResultsViewed(
  input: RecordResultsViewedInput,
): Promise<void> {
  try {
    const variables = buildResultsViewedVariables(input)
    if (!variables) return
    await mutateEvent(variables)
  } catch {
    // Swallow everything, incl. a SYNC getter throw (fire-and-forget
    // sync-throw law): shed/failed events are the designed outcome (KTD6).
  }
}

function mutateEvent(variables: RecordWatchSearchEventVariables) {
  return getApolloClient().mutate({
    mutation: RECORD_WATCH_SEARCH_EVENT,
    variables,
    // Event acks must not accumulate in the long-lived InMemoryCache.
    fetchPolicy: "no-cache",
  })
}
