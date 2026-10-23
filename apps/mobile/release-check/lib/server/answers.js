"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// Answers that never reach admin: saved search answers (KTD10) and the copy of
// a first read for its repeats (R35).

const { valueFromASTUntyped } = require("graphql")

const { executeWithRoot } = require("./successReply")

// Entry: { input: { query, limit, offset, language }, response, recordedAt }.
// The key is WATCH_SEARCH's `$input.query`, `.limit`, `.offset`, and
// `.displayLanguageSlug`; the app derives `queryLanguageSlug` from the query.
const SEARCH_FIELD = "Query.watchSearch"

function nullable(input) {
  return input === undefined ? null : input
}

function searchInputOf(classified) {
  const field = classified.fieldNodes.find(
    (item) => item.coordinate === SEARCH_FIELD,
  )
  const argument = field?.node.arguments?.find(
    (item) => item.name.value === "input",
  )
  const variables = classified.request.variables
  const input = argument
    ? valueFromASTUntyped(
        argument.value,
        typeof variables === "object" && variables !== null ? variables : {},
      )
    : null
  const read = typeof input === "object" && input !== null ? input : {}
  return {
    query: typeof read.query === "string" ? read.query : null,
    limit: nullable(read.limit),
    offset: nullable(read.offset),
    language: nullable(read.displayLanguageSlug),
  }
}

function samePage(entry, search) {
  return (
    nullable(entry.input?.limit) === search.limit &&
    nullable(entry.input?.offset) === search.offset &&
    nullable(entry.input?.language) === search.language
  )
}

function emptyWatchSearch(search) {
  return {
    query: search.query,
    hasMore: false,
    nextOffset: search.offset ?? 0,
    requestId: null,
    latencyMs: 0,
    degraded: false,
    searchMode: null,
    results: [],
  }
}

function missingSearchAnswer(search) {
  return {
    errors: [
      {
        message: `No saved search answer for ${JSON.stringify(search.query)}. Record one with record-search.`,
        extensions: { code: "MISSING_SEARCH_ANSWER" },
      },
    ],
    data: null,
  }
}

// The saved answer, an empty answer for a strict prefix of a saved query (so
// typing speed changes nothing), or a MISSING_SEARCH_ANSWER error.
async function answerSearch(classified, searchAnswers, schema) {
  const search = searchInputOf(classified)
  if ((classified.rootFields[SEARCH_FIELD] ?? 0) !== 1) {
    return {
      route: "blocked",
      reason: "search-field-count",
      body: null,
      search,
    }
  }
  const entries = Array.isArray(searchAnswers?.answers)
    ? searchAnswers.answers
    : []
  const page = entries.filter((entry) => samePage(entry, search))
  const saved = page.find((entry) => entry.input?.query === search.query)
  if (saved) return { route: "saved-answer", body: saved.response, search }
  const isPrefix =
    search.query !== null &&
    page.some(
      (entry) =>
        typeof entry.input?.query === "string" &&
        entry.input.query.length > search.query.length &&
        entry.input.query.startsWith(search.query),
    )
  if (isPrefix) {
    const body = await executeWithRoot(schema, classified, {
      watchSearch: emptyWatchSearch(search),
    })
    return { route: "prefix-answer", body, search }
  }
  return {
    route: "missing-search-answer",
    body: missingSearchAnswer(search),
    search,
  }
}

function canonicalJson(input) {
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(",")}]`
  if (typeof input === "object" && input !== null) {
    const keys = Object.keys(input).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(input) ?? "null"
}

function reuseKey(request) {
  return canonicalJson({
    query: request.query,
    variables: request.variables ?? null,
    operationName: request.operationName ?? null,
  })
}

function isReusable(status, parsed) {
  return (
    status === 200 &&
    typeof parsed === "object" &&
    parsed !== null &&
    typeof parsed.data === "object" &&
    parsed.data !== null &&
    (parsed.errors === undefined ||
      (Array.isArray(parsed.errors) && parsed.errors.length === 0))
  )
}

function createReuseStore() {
  const answers = new Map()
  return {
    get: (key) => answers.get(key) ?? null,
    put(key, text) {
      answers.set(key, text)
    },
    size: () => answers.size,
  }
}

module.exports = {
  SEARCH_FIELD,
  answerSearch,
  canonicalJson,
  createReuseStore,
  isReusable,
  reuseKey,
  searchInputOf,
}
