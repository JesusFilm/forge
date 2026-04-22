import type {
  AutomationRefreshMode,
  AutomationTemplate,
} from "../../enrichment-automation/services/types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

type AutomationOutputOwner = "missing" | "ai" | "human"

type AutomationCandidateRow = {
  document_id: string | null
  core_id: string | null
  output_owner: AutomationOutputOwner | null
  eligible_count: number | string | null
  skipped_duplicate_count: number | string | null
}

export type AutomationCandidateResult = {
  documentId: string
  coreId: string
  outputOwner: AutomationOutputOwner
}

export type AutomationCandidatesResult = {
  eligibleCount: number
  skippedDuplicateCount: number
  candidates: AutomationCandidateResult[]
}

export type AutomationCandidatesInput = {
  template: Extract<
    AutomationTemplate,
    "source_subtitles_missing" | "target_subtitles_missing" | "metadata_missing"
  >
  refreshMode: AutomationRefreshMode
  targetLanguageIds: string[]
  limit: number
}

function readCount(value: number | string | null | undefined): number {
  const count = Number(value ?? 0)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

function buildAutomationTargetKey(targetLanguageIds: string[]): string {
  const targetLanguageKey = Array.from(new Set(targetLanguageIds))
    .sort((left, right) => left.localeCompare(right))
    .join(",")
  return targetLanguageKey || "source"
}

function buildBaseVideoPredicate(): string {
  return `
    v.published_at IS NOT NULL
    AND v.core_id IS NOT NULL
    AND COALESCE(v.label, '') NOT IN ('collection', 'series')`
}

function buildMetadataPredicate(refreshMode: AutomationRefreshMode): string {
  if (refreshMode === "refresh_ai_generated") {
    return "v.ai_metadata IS DISTINCT FROM FALSE"
  }
  return "v.ai_metadata IS NULL"
}

function buildSubtitleOwnershipCte(
  targetLanguageIds: string[],
  bindings: unknown[],
): string {
  const hasLanguageFilter = targetLanguageIds.length > 0
  const languageJoins = hasLanguageFilter
    ? `
        JOIN video_subtitles_language_lnk sll ON sll.video_subtitle_id = s.id
        JOIN languages l ON l.id = sll.language_id AND l.core_id = ANY(?)`
    : ""

  if (hasLanguageFilter) {
    bindings.push(targetLanguageIds)
  }

  return `
    subtitle_ownership AS (
      SELECT
        svl.video_id,
        BOOL_OR(NOT COALESCE(s.ai_generated, false)) AS has_human,
        BOOL_OR(COALESCE(s.ai_generated, false)) AS has_ai
      FROM video_subtitles s
      JOIN video_subtitles_video_lnk svl ON svl.video_subtitle_id = s.id
      ${languageJoins}
      WHERE s.published_at IS NOT NULL
      GROUP BY svl.video_id
    ),`
}

function buildEligibleOwnerPredicate(
  refreshMode: AutomationRefreshMode,
): string {
  if (refreshMode === "refresh_ai_generated") {
    return "output_owner IN ('missing', 'ai')"
  }
  return "output_owner = 'missing'"
}

function buildEligibleSql(
  input: AutomationCandidatesInput,
  bindings: unknown[],
): string {
  if (input.template === "metadata_missing") {
    return `
    eligible AS (
      SELECT
        v.document_id,
        v.core_id,
        CASE
          WHEN v.ai_metadata IS TRUE THEN 'ai'
          ELSE 'missing'
        END AS output_owner,
        CONCAT(?::text, ':', v.document_id, ':', ?::text) AS automation_key,
        v.title AS sort_title
      FROM videos v
      WHERE ${buildBaseVideoPredicate()}
        AND ${buildMetadataPredicate(input.refreshMode)}
    ),`
  }

  const targetLanguageIds =
    input.template === "target_subtitles_missing" ? input.targetLanguageIds : []
  const subtitleOwnershipCte = buildSubtitleOwnershipCte(
    targetLanguageIds,
    bindings,
  )
  const aiPredicate =
    input.refreshMode === "missing_only"
      ? "AND COALESCE(so.has_ai, false) = false"
      : ""

  return `
    ${subtitleOwnershipCte}
    eligible AS (
      SELECT
        v.document_id,
        v.core_id,
        CASE
          WHEN COALESCE(so.has_ai, false) THEN 'ai'
          ELSE 'missing'
        END AS output_owner,
        CONCAT(?::text, ':', v.document_id, ':', ?::text) AS automation_key,
        v.title AS sort_title
      FROM videos v
      LEFT JOIN subtitle_ownership so ON so.video_id = v.id
      WHERE ${buildBaseVideoPredicate()}
        AND COALESCE(so.has_human, false) = false
        ${aiPredicate}
    ),`
}

export async function queryAutomationCandidates(
  knex: KnexInstance,
  input: AutomationCandidatesInput,
): Promise<AutomationCandidatesResult> {
  const bindings: unknown[] = []
  const targetKey = buildAutomationTargetKey(input.targetLanguageIds)
  const eligibleSql = buildEligibleSql(input, bindings)

  bindings.push(input.template, targetKey, input.limit)

  const sql = `
    WITH ${eligibleSql}
    running_jobs AS (
      SELECT automation_key
      FROM enrichment_jobs
      WHERE status IN ('pending', 'running')
        AND automation_key IS NOT NULL
      GROUP BY automation_key
    ),
    scored AS (
      SELECT
        eligible.*,
        running_jobs.automation_key IS NOT NULL AS is_duplicate
      FROM eligible
      LEFT JOIN running_jobs ON running_jobs.automation_key = eligible.automation_key
      WHERE ${buildEligibleOwnerPredicate(input.refreshMode)}
    ),
    selected AS (
      SELECT *
      FROM scored
      WHERE NOT is_duplicate
      ORDER BY sort_title NULLS LAST, document_id
      LIMIT ?
    ),
    summary AS (
      SELECT
        COUNT(*) FILTER (WHERE NOT is_duplicate)::int AS eligible_count,
        COUNT(*) FILTER (WHERE is_duplicate)::int AS skipped_duplicate_count
      FROM scored
    )
    SELECT
      selected.document_id,
      selected.core_id,
      selected.output_owner,
      summary.eligible_count,
      summary.skipped_duplicate_count
    FROM summary
    LEFT JOIN selected ON TRUE
    ORDER BY selected.sort_title NULLS LAST, selected.document_id
  `

  const result: { rows: AutomationCandidateRow[] } = await knex.raw(
    sql,
    bindings,
  )
  const rows = result.rows ?? []

  return {
    eligibleCount: readCount(rows[0]?.eligible_count),
    skippedDuplicateCount: readCount(rows[0]?.skipped_duplicate_count),
    candidates: rows
      .filter(
        (
          row,
        ): row is AutomationCandidateRow & {
          document_id: string
          core_id: string
          output_owner: AutomationOutputOwner
        } =>
          row.document_id != null &&
          row.core_id != null &&
          row.output_owner != null,
      )
      .map((row) => ({
        documentId: row.document_id,
        coreId: row.core_id,
        outputOwner: row.output_owner,
      })),
  }
}
