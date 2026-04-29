#!/usr/bin/env tsx
/**
 * Pre-ship verification for the browse-modal category grid.
 *
 * For each entry in src/lib/search-categories.ts, runs the semanticSearch
 * GraphQL query against a live endpoint and prints a `searchTerm | count |
 * pass` table. Exits non-zero if any searchTerm returns fewer than
 * MIN_RESULTS — the team revises the static array before merge rather than
 * letting the grid ship with weak categories.
 *
 * Run: GRAPHQL_URL=https://... pnpm -F @forge/web verify:categories
 * Or:  NEXT_PUBLIC_GRAPHQL_URL already set in the shell
 *
 * Intentionally avoids importing @/lib/client or @/lib/search so the script
 * does not drag apps/web's client-only module graph (env-schema validation,
 * next/navigation hooks, Apollo boot) into a plain Node execution context.
 */

import { CATEGORIES } from "../src/lib/search-categories"

const MIN_RESULTS = 6
const LOCALE = "en"

const SEMANTIC_SEARCH_QUERY = /* GraphQL */ `
  query VerifyCategorySearch(
    $query: String!
    $locale: String!
    $limit: Int
    $offset: Int
  ) {
    semanticSearch(
      query: $query
      locale: $locale
      limit: $limit
      offset: $offset
    ) {
      results {
        id
      }
    }
  }
`

type SemanticSearchResponse = {
  data?: {
    semanticSearch?: {
      results?: { id: number }[]
    }
  }
  errors?: { message: string }[]
}

async function runSearch(
  endpoint: string,
  term: string,
): Promise<number | Error> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: SEMANTIC_SEARCH_QUERY,
        variables: { query: term, locale: LOCALE, limit: 20, offset: 0 },
      }),
    })
    if (!res.ok) {
      return new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    const body = (await res.json()) as SemanticSearchResponse
    if (body.errors && body.errors.length > 0) {
      return new Error(body.errors.map((e) => e.message).join("; "))
    }
    return body.data?.semanticSearch?.results?.length ?? 0
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

async function main() {
  const endpoint =
    process.env.GRAPHQL_URL ??
    process.env.NEXT_PUBLIC_GRAPHQL_URL ??
    process.env.INTERNAL_GRAPHQL_URL
  if (!endpoint) {
    console.error(
      "Missing GraphQL endpoint. Set GRAPHQL_URL, NEXT_PUBLIC_GRAPHQL_URL, or INTERNAL_GRAPHQL_URL.",
    )
    process.exit(2)
  }

  console.log(`Verifying ${CATEGORIES.length} categories at ${endpoint}`)
  console.log(`Locale: ${LOCALE}    Minimum results: ${MIN_RESULTS}\n`)

  const rows: Array<{ term: string; count: number | string; pass: boolean }> =
    []
  let anyFailed = false
  for (const cat of CATEGORIES) {
    const result = await runSearch(endpoint, cat.searchTerm)
    if (result instanceof Error) {
      rows.push({
        term: cat.searchTerm,
        count: `error: ${result.message}`,
        pass: false,
      })
      anyFailed = true
      continue
    }
    const pass = result >= MIN_RESULTS
    rows.push({ term: cat.searchTerm, count: result, pass })
    if (!pass) anyFailed = true
  }

  const termColWidth = Math.max(
    ...rows.map((r) => r.term.length),
    "searchTerm".length,
  )
  console.log(`${"searchTerm".padEnd(termColWidth)}  count  pass`)
  console.log(`${"-".repeat(termColWidth)}  -----  ----`)
  for (const row of rows) {
    const countStr = String(row.count).padStart(5)
    const mark = row.pass ? "✓" : "✗"
    console.log(`${row.term.padEnd(termColWidth)}  ${countStr}  ${mark}`)
  }

  if (anyFailed) {
    console.error(
      `\n❌ At least one category returned fewer than ${MIN_RESULTS} results. Revise the CATEGORIES array in src/lib/search-categories.ts before merge.`,
    )
    process.exit(1)
  }
  console.log(
    `\n✅ All ${CATEGORIES.length} categories passed the ≥${MIN_RESULTS}-result gate.`,
  )
}

void main()
