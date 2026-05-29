import "server-only"

import { z } from "zod"

import { env } from "@/env"
import {
  toYouVersionReference,
  type YouVersionCitationLike,
} from "@/lib/youversion-reference"

const YOUVERSION_API_BASE_URL = "https://api.youversion.com/v1"
const YOUVERSION_FETCH_REVALIDATE_SECONDS = 60 * 60 * 24
const YOUVERSION_ENRICHMENT_TIMEOUT_MS = 2000
const YOUVERSION_MAX_PASSAGES_PER_PAGE = 6

const YouVersionVersionSchema = z
  .object({
    copyright: z.string().optional().nullable(),
    copyright_long: z.string().optional().nullable(),
    copyright_short: z.string().optional().nullable(),
    id: z.number().int().positive(),
    localized_abbreviation: z.string().optional().nullable(),
    localized_title: z.string().optional().nullable(),
    publisher_url: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    youversion_deep_link: z.string().optional().nullable(),
  })
  .passthrough()

const YouVersionPassageSchema = z
  .object({
    content: z.string().trim().min(1),
    id: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
  })
  .passthrough()

type YouVersionVersion = z.infer<typeof YouVersionVersionSchema>
type YouVersionPassageResponse = z.infer<typeof YouVersionPassageSchema>

export type YouVersionBibleQuotePassage = {
  citationDocumentId: string
  content: string
  copyright: string
  humanReference: string
  publisherUrl: string | null
  reference: string
  versionAbbreviation: string | null
  versionId: number
  versionTitle: string | null
}

export type YouVersionBibleQuoteCitation = Exclude<
  YouVersionCitationLike,
  null
> & {
  documentId?: string | null
}

type FetchYouVersionBibleQuotePassagesOptions = {
  timeoutMs?: number
}

type RequestedPassage = {
  citationDocumentId: string
  reference: string
}

export async function fetchYouVersionBibleQuotePassages(
  citations:
    | readonly (YouVersionBibleQuoteCitation | null)[]
    | null
    | undefined,
  options: FetchYouVersionBibleQuotePassagesOptions = {},
): Promise<YouVersionBibleQuotePassage[]> {
  const appKey = env.YOUVERSION_APP_KEY?.trim()
  if (!appKey) return []

  const requestedPassages = (citations ?? [])
    .map((citation) => {
      if (citation == null) return null
      const reference = toYouVersionReference(citation)
      const citationDocumentId = citation.documentId ?? null
      if (reference == null || !citationDocumentId) return null
      return { citationDocumentId, reference }
    })
    .filter(
      (
        passage,
      ): passage is {
        citationDocumentId: string
        reference: string
      } => passage != null,
    )
    .slice(0, YOUVERSION_MAX_PASSAGES_PER_PAGE)

  if (requestedPassages.length === 0) return []

  const timeoutMs = Math.max(
    1,
    options.timeoutMs ?? YOUVERSION_ENRICHMENT_TIMEOUT_MS,
  )
  return runWithTimeout(
    (signal) =>
      fetchYouVersionBibleQuotePassagesWithinBudget({
        appKey,
        requestedPassages,
        signal,
        versionId: env.YOUVERSION_DEFAULT_VERSION_ID,
      }),
    timeoutMs,
    [],
  )
}

async function fetchYouVersionBibleQuotePassagesWithinBudget({
  appKey,
  requestedPassages,
  signal,
  versionId,
}: {
  appKey: string
  requestedPassages: RequestedPassage[]
  signal: AbortSignal
  versionId: number
}) {
  const version = await fetchYouVersionVersion(appKey, versionId, signal)
  if (version == null) return []

  const copyright = getVersionCopyright(version)
  if (copyright == null) {
    console.warn("[youversion] version metadata omitted required copyright", {
      versionId,
    })
    return []
  }

  const uniqueReferences = Array.from(
    new Set(requestedPassages.map(({ reference }) => reference)),
  )
  const passageResults = await Promise.allSettled(
    uniqueReferences.map(async (reference) => {
      const passage = await fetchYouVersionPassage(
        appKey,
        versionId,
        reference,
        signal,
      )
      return [reference, passage] as const
    }),
  )
  const passagesByReference = new Map<string, YouVersionPassageResponse>()
  for (const result of passageResults) {
    if (result.status === "fulfilled" && result.value[1] != null) {
      passagesByReference.set(result.value[0], result.value[1])
    }
  }

  const passageResponses = requestedPassages.map(
    ({ citationDocumentId, reference }) => {
      const passage = passagesByReference.get(reference)
      if (passage == null) return null
      return buildBibleQuotePassage({
        citationDocumentId,
        copyright,
        passage,
        reference,
        version,
      })
    },
  )

  return passageResponses.filter(
    (passage): passage is YouVersionBibleQuotePassage => passage != null,
  )
}

async function fetchYouVersionVersion(
  appKey: string,
  versionId: number,
  signal: AbortSignal,
): Promise<YouVersionVersion | null> {
  return fetchYouVersionJson(
    `${YOUVERSION_API_BASE_URL}/bibles/${versionId}`,
    appKey,
    YouVersionVersionSchema,
    signal,
  )
}

async function fetchYouVersionPassage(
  appKey: string,
  versionId: number,
  reference: string,
  signal: AbortSignal,
): Promise<YouVersionPassageResponse | null> {
  const url = new URL(
    `${YOUVERSION_API_BASE_URL}/bibles/${versionId}/passages/${encodeURIComponent(reference)}`,
  )
  url.searchParams.set("format", "text")
  url.searchParams.set("include_headings", "false")
  url.searchParams.set("include_notes", "false")

  return fetchYouVersionJson(
    url.toString(),
    appKey,
    YouVersionPassageSchema,
    signal,
  )
}

async function fetchYouVersionJson<T>(
  url: string,
  appKey: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T | null> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-YVP-App-Key": appKey,
      },
      next: { revalidate: YOUVERSION_FETCH_REVALIDATE_SECONDS },
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) return null
    console.warn("[youversion] request failed", { error, url })
    return null
  }

  if (!response.ok) {
    console.warn("[youversion] request returned non-ok status", {
      status: response.status,
      url,
    })
    return null
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    console.warn("[youversion] response was not valid JSON", { error, url })
    return null
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.warn("[youversion] response shape was invalid", {
      error: parsed.error,
      url,
    })
    return null
  }

  return parsed.data
}

function buildBibleQuotePassage({
  citationDocumentId,
  copyright,
  passage,
  reference,
  version,
}: {
  citationDocumentId: string
  copyright: string
  passage: YouVersionPassageResponse
  reference: string
  version: YouVersionVersion
}): YouVersionBibleQuotePassage {
  return {
    citationDocumentId,
    content: passage.content.trim(),
    copyright,
    humanReference: normalizeOptionalString(passage.reference) ?? reference,
    publisherUrl: normalizeHttpUrl(version.publisher_url),
    reference: normalizeOptionalString(passage.id) ?? reference,
    versionAbbreviation: normalizeOptionalString(
      version.localized_abbreviation,
    ),
    versionId: version.id,
    versionTitle:
      normalizeOptionalString(version.localized_title) ??
      normalizeOptionalString(version.title),
  }
}

function getVersionCopyright(version: YouVersionVersion) {
  return (
    normalizeOptionalString(version.copyright) ??
    normalizeOptionalString(version.copyright_short) ??
    normalizeOptionalString(version.copyright_long)
  )
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeHttpUrl(value: string | null | undefined) {
  const trimmed = normalizeOptionalString(value)
  if (trimmed == null) return null

  try {
    const url = new URL(trimmed)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}

async function runWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      abortController.abort()
      resolve(fallback)
    }, timeoutMs)
  })

  try {
    return await Promise.race([run(abortController.signal), timeout])
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId)
  }
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  )
}
