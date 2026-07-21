#!/usr/bin/env tsx

import { randomUUID } from "node:crypto"

import { PrismaClient } from "@prisma/client"

import { toPgArray } from "@/db/pgvector"

const DEFAULT_MAX_PER_LANGUAGE = 5
const DEFAULT_MIN_SCORE = 0.35

export type SeedLanguageFallbackArgs = {
  execute: boolean
  verbose: boolean
  maxPerLanguage: number
  minScore: number
  sourceLanguageSlug?: string
  limit?: number
}

export type LanguageSeedRow = {
  id: string
  slug: string | null
  bcp47: string | null
  iso3: string | null
  englishName: string | null
}

export type CountryLanguageSeedRow = {
  countryId: string
  countryName: string | null
  countryPopulation: number | null
  countryLanguageRows: number
  languageId: string
  speakers: number | null
  primary: boolean | null
  suggested: boolean | null
  order: number | null
}

export type LanguageFallbackCandidate = {
  sourceLanguageId: string
  sourceLanguageSlug: string | null
  sourceEnglishName: string | null
  fallbackLanguageId: string
  fallbackLanguageSlug: string | null
  fallbackEnglishName: string | null
  priority: number
  score: number
  reason: string
}

type CandidateAccumulator = {
  sourceLanguageId: string
  fallbackLanguageId: string
  sharedCountries: Set<string>
  sharedCountryNames: Set<string>
  countryScore: number
  speakerScore: number
  primaryScore: number
  suggestedScore: number
  variantScore: number
  mediaScore: number
  mediaCount: number
  reasonTags: Set<string>
}

function valueFor(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function positiveIntArg(
  argv: readonly string[],
  name: string,
): number | undefined {
  const raw = valueFor(argv, name)
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return parsed
}

function positiveFloatArg(
  argv: readonly string[],
  name: string,
): number | undefined {
  const raw = valueFor(argv, name)
  if (!raw) return undefined
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number`)
  }
  return parsed
}

export function parseArgs(argv: readonly string[]): SeedLanguageFallbackArgs {
  return {
    execute: argv.includes("--execute"),
    verbose: argv.includes("--verbose"),
    maxPerLanguage:
      positiveIntArg(argv, "max-per-language") ?? DEFAULT_MAX_PER_LANGUAGE,
    minScore: positiveFloatArg(argv, "min-score") ?? DEFAULT_MIN_SCORE,
    sourceLanguageSlug: valueFor(argv, "source-language-slug"),
    limit: positiveIntArg(argv, "limit"),
  }
}

function bcp47Base(value: string | null): string | null {
  if (!value) return null
  const [base] = value.toLowerCase().split("-")
  return base || null
}

function speakerShare(
  speakers: number | null,
  countryPopulation: number | null,
): number {
  if (!speakers || speakers <= 0) return 0
  if (countryPopulation && countryPopulation > 0) {
    return Math.min(1, Math.sqrt(speakers / countryPopulation))
  }
  return Math.min(1, Math.log10(speakers + 1) / 8)
}

function countryDampener(countryLanguageRows: number): number {
  return 1 / Math.log2(Math.max(4, countryLanguageRows))
}

function mediaScore(count: number): number {
  if (count <= 0) return 0
  return Math.min(0.5, Math.log10(count + 1) / 6)
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

function accumulatorKey(sourceLanguageId: string, fallbackLanguageId: string) {
  return `${sourceLanguageId}:${fallbackLanguageId}`
}

function ensureAccumulator({
  accumulators,
  sourceLanguageId,
  fallbackLanguageId,
}: {
  accumulators: Map<string, CandidateAccumulator>
  sourceLanguageId: string
  fallbackLanguageId: string
}): CandidateAccumulator {
  const key = accumulatorKey(sourceLanguageId, fallbackLanguageId)
  const existing = accumulators.get(key)
  if (existing) return existing

  const created: CandidateAccumulator = {
    sourceLanguageId,
    fallbackLanguageId,
    sharedCountries: new Set(),
    sharedCountryNames: new Set(),
    countryScore: 0,
    speakerScore: 0,
    primaryScore: 0,
    suggestedScore: 0,
    variantScore: 0,
    mediaScore: 0,
    mediaCount: 0,
    reasonTags: new Set(),
  }
  accumulators.set(key, created)
  return created
}

function reasonForCandidate(candidate: CandidateAccumulator): string {
  const countries = [...candidate.sharedCountryNames].slice(0, 3)
  const details = [
    ...candidate.reasonTags,
    candidate.sharedCountries.size > 0
      ? `shared_countries=${candidate.sharedCountries.size}`
      : null,
    countries.length > 0 ? `examples=${countries.join("|")}` : null,
    candidate.mediaCount > 0 ? `playable_dubs=${candidate.mediaCount}` : null,
  ].filter(Boolean)
  return details.join("; ").slice(0, 512)
}

export function buildLanguageFallbackCandidates({
  languages,
  countryLanguages,
  playableDubCounts,
  maxPerLanguage = DEFAULT_MAX_PER_LANGUAGE,
  minScore = DEFAULT_MIN_SCORE,
}: {
  languages: readonly LanguageSeedRow[]
  countryLanguages: readonly CountryLanguageSeedRow[]
  playableDubCounts: ReadonlyMap<string, number>
  maxPerLanguage?: number
  minScore?: number
}): LanguageFallbackCandidate[] {
  const languageById = new Map(
    languages.map((language) => [language.id, language]),
  )
  const sourceLanguageIds = new Set(
    countryLanguages.map((row) => row.languageId),
  )
  const rowsByCountry = new Map<string, CountryLanguageSeedRow[]>()
  for (const row of countryLanguages) {
    const rows = rowsByCountry.get(row.countryId) ?? []
    rows.push(row)
    rowsByCountry.set(row.countryId, rows)
  }

  const accumulators = new Map<string, CandidateAccumulator>()

  for (const language of languages) {
    if (!sourceLanguageIds.has(language.id)) continue
    const sourceBase = bcp47Base(language.bcp47)
    for (const fallback of languages) {
      if (fallback.id === language.id) continue
      if ((playableDubCounts.get(fallback.id) ?? 0) <= 0) continue
      const fallbackBase = bcp47Base(fallback.bcp47)
      if (!sourceBase || sourceBase !== fallbackBase) continue

      const accumulator = ensureAccumulator({
        accumulators,
        sourceLanguageId: language.id,
        fallbackLanguageId: fallback.id,
      })
      accumulator.variantScore += 4
      accumulator.reasonTags.add("same_bcp47_base")
      if (language.iso3 && language.iso3 === fallback.iso3) {
        accumulator.variantScore += 1
        accumulator.reasonTags.add("same_iso3")
      }
    }
  }

  for (const rows of rowsByCountry.values()) {
    for (const source of rows) {
      for (const fallback of rows) {
        if (source.languageId === fallback.languageId) continue
        if ((playableDubCounts.get(fallback.languageId) ?? 0) <= 0) continue

        const dampener = countryDampener(source.countryLanguageRows)
        const sourceShare = speakerShare(
          source.speakers,
          source.countryPopulation,
        )
        const fallbackShare = speakerShare(
          fallback.speakers,
          fallback.countryPopulation,
        )
        const accumulator = ensureAccumulator({
          accumulators,
          sourceLanguageId: source.languageId,
          fallbackLanguageId: fallback.languageId,
        })

        accumulator.sharedCountries.add(source.countryId)
        if (source.countryName)
          accumulator.sharedCountryNames.add(source.countryName)
        accumulator.countryScore += dampener * (0.08 + sourceShare * 0.24)
        accumulator.speakerScore += dampener * fallbackShare * 0.9

        if (fallback.primary) {
          accumulator.primaryScore += dampener * 0.5
          accumulator.reasonTags.add("fallback_primary")
        }
        if (fallback.suggested) {
          accumulator.suggestedScore += dampener * 0.35
          accumulator.reasonTags.add("fallback_suggested")
        }
        if (source.primary && fallback.primary) {
          accumulator.primaryScore += dampener * 0.2
          accumulator.reasonTags.add("both_primary")
        }
      }
    }
  }

  for (const accumulator of accumulators.values()) {
    const playableDubs =
      playableDubCounts.get(accumulator.fallbackLanguageId) ?? 0
    accumulator.mediaCount = playableDubs
    accumulator.mediaScore = mediaScore(playableDubs)
    if (playableDubs > 0) accumulator.reasonTags.add("has_playable_media")
  }

  const candidatesBySource = new Map<string, LanguageFallbackCandidate[]>()
  for (const accumulator of accumulators.values()) {
    if (accumulator.mediaCount <= 0) continue
    const score = roundScore(
      accumulator.variantScore +
        accumulator.countryScore +
        accumulator.speakerScore +
        accumulator.primaryScore +
        accumulator.suggestedScore +
        accumulator.mediaScore,
    )
    if (score < minScore) continue

    const sourceLanguage = languageById.get(accumulator.sourceLanguageId)
    const fallbackLanguage = languageById.get(accumulator.fallbackLanguageId)
    if (!sourceLanguage || !fallbackLanguage) continue

    const rows = candidatesBySource.get(accumulator.sourceLanguageId) ?? []
    rows.push({
      sourceLanguageId: accumulator.sourceLanguageId,
      sourceLanguageSlug: sourceLanguage.slug,
      sourceEnglishName: sourceLanguage.englishName,
      fallbackLanguageId: accumulator.fallbackLanguageId,
      fallbackLanguageSlug: fallbackLanguage.slug,
      fallbackEnglishName: fallbackLanguage.englishName,
      priority: 0,
      score,
      reason: reasonForCandidate(accumulator),
    })
    candidatesBySource.set(accumulator.sourceLanguageId, rows)
  }

  const selected: LanguageFallbackCandidate[] = []
  for (const rows of candidatesBySource.values()) {
    rows.sort((a, b) => {
      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) return scoreDelta
      return a.fallbackLanguageId.localeCompare(b.fallbackLanguageId)
    })
    selected.push(
      ...rows.slice(0, maxPerLanguage).map((row, index) => ({
        ...row,
        priority: index + 1,
      })),
    )
  }

  return selected.sort((a, b) => {
    const sourceDelta = (
      a.sourceLanguageSlug ?? a.sourceLanguageId
    ).localeCompare(b.sourceLanguageSlug ?? b.sourceLanguageId)
    if (sourceDelta !== 0) return sourceDelta
    return a.priority - b.priority
  })
}

async function loadLanguages(
  prisma: PrismaClient,
  sourceLanguageSlug?: string,
  limit?: number,
): Promise<LanguageSeedRow[]> {
  return prisma.$queryRaw<LanguageSeedRow[]>`
    SELECT
      id,
      slug,
      bcp47,
      iso3,
      name->>'en' AS "englishName"
    FROM language
    WHERE deleted_at IS NULL
      AND slug IS NOT NULL
      AND (${sourceLanguageSlug ?? null}::text IS NULL OR slug = ${sourceLanguageSlug ?? null})
    ORDER BY slug ASC
    LIMIT ${limit ?? 100000}
  `
}

async function loadCountryLanguages(
  prisma: PrismaClient,
  sourceLanguageIds: readonly string[],
): Promise<CountryLanguageSeedRow[]> {
  if (sourceLanguageIds.length === 0) return []

  return prisma.$queryRaw<CountryLanguageSeedRow[]>`
    WITH source_countries AS (
      SELECT DISTINCT country_id
      FROM country_language
      WHERE deleted_at IS NULL
        AND language_id = ANY(${toPgArray(sourceLanguageIds)}::text[])
    ),
    active_country_language_counts AS (
      SELECT country_id, COUNT(*)::int AS row_count
      FROM country_language
      WHERE deleted_at IS NULL
      GROUP BY country_id
    )
    SELECT
      cl.country_id AS "countryId",
      country.name->>'en' AS "countryName",
      country.population AS "countryPopulation",
      counts.row_count AS "countryLanguageRows",
      cl.language_id AS "languageId",
      cl.speakers,
      cl."primary",
      cl.suggested,
      cl."order"
    FROM country_language cl
    JOIN source_countries source_country
      ON source_country.country_id = cl.country_id
    JOIN active_country_language_counts counts
      ON counts.country_id = cl.country_id
    JOIN country
      ON country.id = cl.country_id
     AND country.deleted_at IS NULL
    JOIN language
      ON language.id = cl.language_id
     AND language.deleted_at IS NULL
     AND language.slug IS NOT NULL
    WHERE cl.deleted_at IS NULL
    ORDER BY cl.country_id ASC, cl."primary" DESC NULLS LAST, cl.speakers DESC NULLS LAST
  `
}

async function loadPlayableDubCounts(
  prisma: PrismaClient,
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<
    Array<{ languageId: string; count: bigint }>
  >`
    SELECT language_id AS "languageId", COUNT(*) AS count
    FROM video_dub
    WHERE language_id IS NOT NULL
      AND deleted_at IS NULL
      AND published = true
      AND hls IS NOT NULL
      AND hls <> ''
    GROUP BY language_id
  `
  return new Map(rows.map((row) => [row.languageId, Number(row.count)]))
}

async function writeFallbacks(
  prisma: PrismaClient,
  candidates: readonly LanguageFallbackCandidate[],
  sourceLanguageIds: readonly string[],
): Promise<void> {
  if (sourceLanguageIds.length === 0) return

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE language_fallback
      SET deleted_at = NOW(),
          updated_at = NOW()
      WHERE source = 'core'::"SourceTier"
        AND source_language_id = ANY(${toPgArray(sourceLanguageIds)}::text[])
        AND deleted_at IS NULL
    `

    if (candidates.length === 0) return

    await tx.$executeRaw`
      INSERT INTO language_fallback (
        id,
        source,
        source_language_id,
        fallback_language_id,
        priority,
        reason,
        synced_at,
        created_at,
        updated_at,
        deleted_at
      )
      SELECT
        input.id,
        'core'::"SourceTier",
        input.source_language_id,
        input.fallback_language_id,
        input.priority_text::int,
        input.reason,
        NOW(),
        NOW(),
        NOW(),
        NULL
      FROM unnest(
        ${toPgArray(candidates.map(() => randomUUID()))}::text[],
        ${toPgArray(candidates.map((row) => row.sourceLanguageId))}::text[],
        ${toPgArray(candidates.map((row) => row.fallbackLanguageId))}::text[],
        ${toPgArray(candidates.map((row) => row.priority.toString()))}::text[],
        ${toPgArray(candidates.map((row) => row.reason))}::text[]
      ) AS input(
        id,
        source_language_id,
        fallback_language_id,
        priority_text,
        reason
      )
      ON CONFLICT (source_language_id, fallback_language_id)
      DO UPDATE SET
        source = EXCLUDED.source,
        priority = EXCLUDED.priority,
        reason = EXCLUDED.reason,
        synced_at = EXCLUDED.synced_at,
        updated_at = EXCLUDED.updated_at,
        deleted_at = NULL
    `
  })
}

function printSummary(candidates: readonly LanguageFallbackCandidate[]): void {
  const sourceCount = new Set(candidates.map((row) => row.sourceLanguageId))
    .size
  console.log(
    JSON.stringify(
      {
        event: "language-fallbacks.seed.summary",
        sources: sourceCount,
        fallbacks: candidates.length,
      },
      null,
      2,
    ),
  )
}

function printSample(candidates: readonly LanguageFallbackCandidate[]): void {
  for (const row of candidates.slice(0, 40)) {
    console.log(
      [
        row.sourceLanguageSlug ?? row.sourceLanguageId,
        "->",
        row.fallbackLanguageSlug ?? row.fallbackLanguageId,
        `priority=${row.priority}`,
        `score=${row.score}`,
        row.reason,
      ].join(" "),
    )
  }
}

export async function runSeedLanguageFallbacks(
  prisma: PrismaClient,
  args: SeedLanguageFallbackArgs,
): Promise<LanguageFallbackCandidate[]> {
  const sourceLanguages = await loadLanguages(
    prisma,
    args.sourceLanguageSlug,
    args.limit,
  )
  const allLanguages = args.sourceLanguageSlug
    ? await loadLanguages(prisma)
    : sourceLanguages
  const sourceLanguageIds = sourceLanguages.map((language) => language.id)
  const [countryLanguages, playableDubCounts] = await Promise.all([
    loadCountryLanguages(prisma, sourceLanguageIds),
    loadPlayableDubCounts(prisma),
  ])

  const candidates = buildLanguageFallbackCandidates({
    languages: allLanguages,
    countryLanguages,
    playableDubCounts,
    maxPerLanguage: args.maxPerLanguage,
    minScore: args.minScore,
  }).filter((candidate) =>
    sourceLanguageIds.includes(candidate.sourceLanguageId),
  )

  if (args.verbose) printSample(candidates)
  printSummary(candidates)

  if (!args.execute) {
    console.warn(
      "[language-fallbacks:seed] dry run only; pass --execute to write language_fallback rows.",
    )
    return candidates
  }

  await writeFallbacks(prisma, candidates, sourceLanguageIds)
  console.log("[language-fallbacks:seed] wrote language_fallback rows.")
  return candidates
}

async function main() {
  const prisma = new PrismaClient()
  try {
    await runSeedLanguageFallbacks(prisma, parseArgs(process.argv.slice(2)))
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
