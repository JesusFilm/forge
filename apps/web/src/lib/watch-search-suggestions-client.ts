"use client"

import type { AdminResultOf, AdminVariablesOf } from "@forge/admin-graphql"
import {
  adminWatchSearchSuggestionsOperation,
  adminWatchSearchSuggestionsQuery,
} from "@forge/admin-graphql/operations"

import { env } from "@/env"
import { normalizeWatchSearchQuery } from "./watch-search-query"

const MAX_SUGGESTIONS = 5
const DEFAULT_TIMEOUT_MS = 3_500

type WatchSearchSuggestionsResult = AdminResultOf<
  typeof adminWatchSearchSuggestionsOperation
>
type WatchSearchSuggestionsGraphqlResponse = {
  data?: WatchSearchSuggestionsResult
  errors?: Array<{ message?: string | null }>
}

export type FetchWatchSearchSuggestionsInput = {
  query: string
  languageSlug: string
  signal?: AbortSignal
  timeoutMs?: number
}

function parseSuggestionTitles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Watch search suggestion response was empty")
  }

  const seen = new Set<string>()
  const titles: string[] = []
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("Watch search suggestion response was malformed")
    }
    const title = item.trim()
    if (!title) continue
    const key = title.normalize("NFC").toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(item)
    if (titles.length === MAX_SUGGESTIONS) break
  }
  return titles
}

export async function fetchWatchSearchSuggestions({
  query,
  languageSlug,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: FetchWatchSearchSuggestionsInput): Promise<string[]> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener("abort", abortFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const variables: AdminVariablesOf<
    typeof adminWatchSearchSuggestionsOperation
  > = {
    input: {
      query: normalizeWatchSearchQuery(query),
      languageSlug,
    },
  }

  try {
    const response = await fetch(env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: adminWatchSearchSuggestionsQuery,
        variables,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(
        `Watch search suggestions failed with HTTP ${response.status}`,
      )
    }

    const payload =
      (await response.json()) as WatchSearchSuggestionsGraphqlResponse
    if (payload.errors?.length) {
      throw new Error(
        payload.errors[0]?.message ?? "Watch search suggestions failed",
      )
    }
    return parseSuggestionTitles(payload.data?.watchSearchSuggestions)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abortFromCaller)
  }
}
