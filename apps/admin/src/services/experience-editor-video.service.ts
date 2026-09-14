export type ExperienceEditorAuthoredDubSelector = {
  videoId: string
  languageId: string | null
  legacyStreamingUrl: string | null
}

export type ExperienceEditorDubLanguage = {
  id: string
  slug: string | null
  bcp47: string | null
  iso3: string | null
  name?: unknown
}

/** Scalar projection used before a selected Dub is hydrated. */
export type ExperienceEditorDubCandidate = {
  id: string
  videoId: string
  languageId: string | null
  language: ExperienceEditorDubLanguage | null
  hls: string | null
  dash: string | null
  share: string | null
  duration: number | null
  lengthInMilliseconds: bigint | null
  deletedAt: Date | null
  updatedAt: Date
  /** Editor eligibility intentionally does not depend on publication state. */
  published?: boolean
}

export type ExperienceEditorDubChoice = {
  key: string
  label: string
  languageId: string | null
  languageSlug: string | null
  bcp47: string | null
  iso3: string | null
  languageIdentity: string
  streamUrl: string
  duration: string
  durationSeconds: number | null
}

export type ExperienceEditorLanguageChip = {
  code: string
  flagUrl: string | null
}

export type ExperienceEditorDubInventoryState =
  | { status: "not-loaded" }
  | { status: "loading" }
  | {
      status: "loaded"
      choices: ExperienceEditorDubChoice[]
      nextCursor: string | null
    }
  | { status: "error"; message: string }

export const NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY: Extract<
  ExperienceEditorDubInventoryState,
  { status: "not-loaded" }
> = {
  status: "not-loaded",
}

export const EMPTY_EXPERIENCE_EDITOR_DUB_INVENTORY: Extract<
  ExperienceEditorDubInventoryState,
  { status: "loaded" }
> = {
  status: "loaded",
  choices: [],
  nextCursor: null,
}

/** Compact cold-path contract. It never carries a complete Dub inventory. */
export type ExperienceEditorVideoSummary = {
  key: string
  id: string
  slug: string
  title: string
  description: string | null
  label: string | null
  labelLabel: string | null
  childCount: number
  isCollectionTarget: boolean
  sourceLabel: string
  sourceTone: "success" | "warning" | "danger" | "info" | "muted"
  dubs: string
  playableLanguageCount: number
  playableLanguageChips: ExperienceEditorLanguageChip[]
  updated: string
  duration: string
  durationSeconds: number | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
  defaultDub: ExperienceEditorDubChoice | null
  authoredDubs: ExperienceEditorDubChoice[]
  dubInventory: ExperienceEditorDubInventoryState
  hasGrounding: boolean
  collectionPreviewItems: Array<{
    key: string
    title: string
    previewImageUrl: string | null
  }>
}

function compactText(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function editorDubStreamUrl(
  dub: Pick<ExperienceEditorDubCandidate, "hls" | "dash" | "share">,
) {
  return compactText(dub.hls) ?? compactText(dub.dash) ?? compactText(dub.share)
}

export function isExperienceEditorPlayableDub(
  dub: Pick<
    ExperienceEditorDubCandidate,
    "deletedAt" | "hls" | "dash" | "share"
  >,
) {
  return dub.deletedAt == null && editorDubStreamUrl(dub) != null
}

export function experienceEditorLanguageIdentity(
  dub: Pick<ExperienceEditorDubCandidate, "id" | "language" | "languageId">,
) {
  const language = dub.language
  const candidate =
    compactText(language?.slug)?.toLowerCase() ??
    compactText(language?.bcp47)?.toLowerCase() ??
    compactText(language?.iso3)?.toLowerCase() ??
    compactText(language?.id ?? dub.languageId)?.toLowerCase()

  return candidate ?? dub.id
}

function durationSecondsForDub(
  dub: Pick<ExperienceEditorDubCandidate, "duration" | "lengthInMilliseconds">,
) {
  if (dub.lengthInMilliseconds != null) {
    return Number(dub.lengthInMilliseconds / BigInt(1000))
  }
  return dub.duration
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "--:--"
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

function localizedLanguageName(value: unknown, locale: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const names = value as Record<string, unknown>
  const normalizedLocale = locale.trim().toLowerCase()
  const baseLocale = normalizedLocale.split("-")[0] ?? normalizedLocale

  for (const code of [normalizedLocale, baseLocale, "en"]) {
    const match = names[code]
    if (typeof match === "string" && match.trim()) return match.trim()
  }
  const fallback = Object.values(names).find(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  )
  return fallback?.trim() ?? null
}

function compareEditorDubCandidates(
  left: ExperienceEditorDubCandidate,
  right: ExperienceEditorDubCandidate,
) {
  const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime()
  return updatedDelta || left.id.localeCompare(right.id)
}

export function createExperienceEditorDubChoice(
  dub: ExperienceEditorDubCandidate,
  locale: string,
): ExperienceEditorDubChoice | null {
  if (!isExperienceEditorPlayableDub(dub)) return null
  const streamUrl = editorDubStreamUrl(dub)
  if (!streamUrl) return null
  const durationSeconds = durationSecondsForDub(dub)

  return {
    key: dub.id,
    label:
      localizedLanguageName(dub.language?.name, locale) ??
      compactText(dub.language?.slug) ??
      compactText(dub.language?.bcp47) ??
      compactText(dub.language?.iso3) ??
      compactText(dub.language?.id ?? dub.languageId) ??
      `Dub ${dub.id}`,
    languageId: dub.language?.id ?? dub.languageId,
    languageSlug: dub.language?.slug ?? null,
    bcp47: dub.language?.bcp47 ?? null,
    iso3: dub.language?.iso3 ?? null,
    languageIdentity: experienceEditorLanguageIdentity(dub),
    streamUrl,
    duration: formatDuration(durationSeconds),
    durationSeconds,
  }
}

export function deduplicateExperienceEditorDubs(
  dubs: readonly ExperienceEditorDubCandidate[],
  locale: string,
) {
  const seen = new Set<string>()
  const choices: ExperienceEditorDubChoice[] = []
  for (const dub of [...dubs].sort(compareEditorDubCandidates)) {
    const choice = createExperienceEditorDubChoice(dub, locale)
    if (!choice || seen.has(choice.languageIdentity)) continue
    seen.add(choice.languageIdentity)
    choices.push(choice)
  }
  return choices
}

function localeMatchesDubLanguage(
  locale: string,
  dub: ExperienceEditorDubCandidate,
) {
  const normalizedLocale = compactText(locale)
    ?.toLowerCase()
    .replaceAll("_", "-")
  if (!normalizedLocale || !dub.language) return false
  const baseLocale = normalizedLocale.split("-")[0] ?? normalizedLocale
  const languageCodes = [
    dub.language.bcp47,
    dub.language.slug,
    dub.language.iso3,
  ]
    .map((code) => compactText(code)?.toLowerCase() ?? null)
    .filter((code): code is string => code != null)
    .map((code) => code.replaceAll("_", "-"))

  return (
    languageCodes.includes(normalizedLocale) ||
    languageCodes.includes(baseLocale) ||
    languageCodes.some((code) => code.startsWith(`${baseLocale}-`))
  )
}

/**
 * Resolves the one Dub whose URL, duration and persisted selector drive the
 * editor. This function is read-only: background resolution never mutates the
 * authored block or its clip range.
 */
export function resolveExperienceEditorDub(
  dubs: readonly ExperienceEditorDubCandidate[],
  locale: string,
  selector: ExperienceEditorAuthoredDubSelector | null,
) {
  const playable = [...dubs]
    .filter(isExperienceEditorPlayableDub)
    .filter((dub) => !selector || dub.videoId === selector.videoId)
    .sort(compareEditorDubCandidates)
  if (playable.length === 0) return null

  if (selector?.languageId) {
    const languageMatch = playable.find(
      (dub) =>
        dub.languageId === selector.languageId ||
        dub.language?.id === selector.languageId,
    )
    if (languageMatch) return languageMatch
  }

  if (selector?.legacyStreamingUrl) {
    const legacyUrl = selector.legacyStreamingUrl.trim()
    const streamMatch = playable.find((dub) =>
      [dub.hls, dub.dash, dub.share].some(
        (stream) => compactText(stream) === legacyUrl,
      ),
    )
    if (streamMatch) return streamMatch
  }

  return (
    playable.find((dub) => localeMatchesDubLanguage(locale, dub)) ??
    playable.find((dub) => compactText(dub.hls) != null) ??
    playable.find(
      (dub) => compactText(dub.dash) != null || compactText(dub.share) != null,
    ) ??
    null
  )
}

export type ExperienceEditorVideoSelectionFields = {
  languageId?: string | null
  streamingUrl?: string | null
  clipStartSeconds?: number
  clipEndSeconds?: number
}

type UpdatedExperienceEditorVideoSelection<
  T extends ExperienceEditorVideoSelectionFields,
> = Omit<T, keyof ExperienceEditorVideoSelectionFields> &
  ExperienceEditorVideoSelectionFields

/** Only an explicit language change is allowed to reset authored trim bounds. */
export function applyIntentionalExperienceEditorDubChoice<
  T extends ExperienceEditorVideoSelectionFields,
>(
  selection: T,
  choice: ExperienceEditorDubChoice,
): UpdatedExperienceEditorVideoSelection<T> {
  const sameLanguage =
    choice.languageId != null
      ? compactText(selection.languageId) === choice.languageId
      : compactText(selection.streamingUrl) === choice.streamUrl
  if (sameLanguage) return selection

  return {
    ...selection,
    languageId: choice.languageId,
    streamingUrl: undefined,
    clipStartSeconds: 0,
    clipEndSeconds: undefined,
  }
}

type ExperienceEditorSummarySelectionRow = {
  videoId: string
  coreId: string
  slug: string
  label: ExperienceEditorVideoSummary["label"]
  videoSource: string | null
  updatedAt: Date
  title: string | null
  description: string | null
  previewImageUrl: string | null
  playableLanguageCount: bigint | number
  defaultDubId: string | null
  chipDubIds: string[] | null
  authoredDubIds: string[] | null
  childCount: bigint | number
  collectionPreviewItems: unknown
  hasGrounding: boolean
}

type HydratedEditorDub = ExperienceEditorDubCandidate & {
  language:
    | (ExperienceEditorDubLanguage & {
        countryLanguages: Array<{
          country: {
            flagPngSrc: string | null
            flagWebpSrc: string | null
          } | null
        }>
      })
    | null
}

type ExperienceEditorSummaryDb = Pick<PrismaClient, "$queryRaw" | "videoDub">

export type ExperienceEditorVideoSummaryRequest = {
  videoIds: readonly string[]
  locale: string
  authoredSelectors?: readonly ExperienceEditorAuthoredDubSelector[]
}

function uniqueNonemptyIds(values: readonly string[]) {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const value of values) {
    const id = compactText(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function selectorsForVideoIds(
  selectors: readonly ExperienceEditorAuthoredDubSelector[],
  videoIds: readonly string[],
) {
  const includedIds = new Set(videoIds)
  return selectors.flatMap((selector, index) => {
    if (!includedIds.has(selector.videoId)) return []
    return [
      {
        video_id: selector.videoId,
        language_id: compactText(selector.languageId),
        legacy_streaming_url: compactText(selector.legacyStreamingUrl),
        selector_order: index,
      },
    ]
  })
}

function toSafeCount(value: bigint | number) {
  const count = typeof value === "bigint" ? Number(value) : value
  return Number.isSafeInteger(count) && count > 0 ? count : 0
}

function summarySource(videoSource: string | null) {
  if (videoSource === "MUX") return { label: "Mux", tone: "info" as const }
  if (videoSource === "CLOUDFLARE") {
    return { label: "Cloudflare", tone: "success" as const }
  }
  if (videoSource === "YOUTUBE") {
    return { label: "YouTube", tone: "warning" as const }
  }
  return { label: "Internal", tone: "muted" as const }
}

function summaryVideoLabel(label: string | null, locale: string) {
  if (!label) return null
  const spanish = locale.toLowerCase().startsWith("es")
  const labels: Record<string, string> = spanish
    ? {
        COLLECTION: "Coleccion",
        EPISODE: "Episodio",
        FEATURE_FILM: "Largometraje",
        SEGMENT: "Segmento",
        SERIES: "Serie",
        SHORT_FILM: "Cortometraje",
        TRAILER: "Tráiler",
        BEHIND_THE_SCENES: "Detrás de cámaras",
      }
    : {
        COLLECTION: "Collection",
        EPISODE: "Episode",
        FEATURE_FILM: "Feature Film",
        SEGMENT: "Segment",
        SERIES: "Series",
        SHORT_FILM: "Short Film",
        TRAILER: "Trailer",
        BEHIND_THE_SCENES: "Behind the Scenes",
      }
  return labels[label] ?? label
}

function summarySourceTone(
  value: ReturnType<typeof summarySource>["tone"],
): ExperienceEditorVideoSummary["sourceTone"] {
  return value
}

function normalizedCollectionPreviewItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    if (typeof record.key !== "string") return []
    return [
      {
        key: record.key,
        title:
          typeof record.title === "string" && record.title.trim()
            ? record.title.trim()
            : "Untitled video",
        previewImageUrl:
          typeof record.previewImageUrl === "string" &&
          record.previewImageUrl.trim()
            ? record.previewImageUrl.trim()
            : null,
      },
    ]
  })
}

function selectedDubIds(rows: readonly ExperienceEditorSummarySelectionRow[]) {
  return uniqueNonemptyIds(
    rows.flatMap((row) => [
      ...(row.defaultDubId ? [row.defaultDubId] : []),
      ...(row.chipDubIds ?? []),
      ...(row.authoredDubIds ?? []),
    ]),
  )
}

function languageChip(
  dub: HydratedEditorDub,
): ExperienceEditorLanguageChip | null {
  const code = compactText(
    dub.language?.iso3 ?? dub.language?.bcp47 ?? dub.language?.slug,
  )?.toUpperCase()
  if (!code) return null
  const country = dub.language?.countryLanguages[0]?.country
  return {
    code,
    flagUrl:
      compactText(country?.flagWebpSrc) ?? compactText(country?.flagPngSrc),
  }
}

function coverageLabel(
  count: number,
  chips: readonly ExperienceEditorLanguageChip[],
) {
  if (count === 0) return "No dubs"
  const label = count === 1 ? "1 dub" : `${count} dubs`
  if (chips.length === 0) return label
  const suffix = count > chips.length ? ", ..." : ""
  return `${label} · ${chips.map((chip) => chip.code).join(", ")}${suffix}`
}

function formatSummaryDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

function normalizeSummaryImageUrl(value: string | null) {
  const trimmed = compactText(value)
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.hostname !== "imagedelivery.net") return trimmed
    const pathParts = url.pathname.split("/").filter(Boolean)
    if (pathParts.length === 2) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/public`
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

/**
 * Selects all winners and aggregates before any Dub relation is hydrated.
 * The CTE only admits the requested videos, and callers enforce the 100-id
 * ceiling so its row and parameter budgets are explicit.
 */
async function selectExperienceEditorSummaryRows(
  db: Pick<ExperienceEditorSummaryDb, "$queryRaw">,
  videoIds: readonly string[],
  locale: string,
  authoredSelectors: readonly ExperienceEditorAuthoredDubSelector[],
) {
  if (videoIds.length > EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE) {
    throw new RangeError("Experience editor video batch exceeds its limit")
  }
  if (videoIds.length === 0) return []

  const requestedJson = JSON.stringify(
    videoIds.map((videoId, index) => ({
      video_id: videoId,
      requested_order: index,
    })),
  )
  const authoredJson = JSON.stringify(
    selectorsForVideoIds(authoredSelectors, videoIds),
  )
  const normalizedLocale = locale.trim().toLowerCase().replaceAll("_", "-")
  const baseLocale = normalizedLocale.split("-")[0] ?? normalizedLocale

  return db.$queryRaw<ExperienceEditorSummarySelectionRow[]>(Prisma.sql`
    WITH requested AS MATERIALIZED (
      SELECT input.video_id, input.requested_order
      FROM jsonb_to_recordset(${requestedJson}::jsonb)
        AS input(video_id text, requested_order integer)
    ),
    authored AS MATERIALIZED (
      SELECT input.video_id,
             input.language_id,
             input.legacy_streaming_url,
             input.selector_order
      FROM jsonb_to_recordset(${authoredJson}::jsonb)
        AS input(
          video_id text,
          language_id text,
          legacy_streaming_url text,
          selector_order integer
        )
    ),
    eligible_dubs AS MATERIALIZED (
      SELECT d.id,
             d.video_id,
             d.language_id,
             d.hls,
             d.dash,
             d.share,
             d.updated_at,
             l.slug AS language_slug,
             l.bcp47,
             l.iso3,
             COALESCE(
               NULLIF(lower(btrim(l.slug)), ''),
               NULLIF(lower(btrim(l.bcp47)), ''),
               NULLIF(lower(btrim(l.iso3)), ''),
               NULLIF(lower(btrim(COALESCE(l.id, d.language_id))), ''),
               d.id
             ) AS language_identity
      FROM video_dub d
      JOIN requested r ON r.video_id = d.video_id
      LEFT JOIN language l ON l.id = d.language_id
      WHERE d.deleted_at IS NULL
        AND COALESCE(
          NULLIF(btrim(d.hls), ''),
          NULLIF(btrim(d.dash), ''),
          NULLIF(btrim(d.share), '')
        ) IS NOT NULL
    ),
    language_winners AS MATERIALIZED (
      SELECT ranked.*
      FROM (
        SELECT e.*,
               row_number() OVER (
                 PARTITION BY e.video_id, e.language_identity
                 ORDER BY e.updated_at DESC NULLS LAST, e.id ASC
               ) AS language_rank
        FROM eligible_dubs e
      ) ranked
      WHERE ranked.language_rank = 1
    )
    SELECT v.id AS "videoId",
           v.core_id AS "coreId",
           v.slug,
           v.label::text AS label,
           v.video_source::text AS "videoSource",
           v.updated_at AS "updatedAt",
           locale_pick.title,
           locale_pick.description,
           image_pick.url AS "previewImageUrl",
           COALESCE(dub_summary.language_count, 0)::bigint
             AS "playableLanguageCount",
           default_pick.id AS "defaultDubId",
           COALESCE(dub_summary.chip_ids, ARRAY[]::text[]) AS "chipDubIds",
           COALESCE(authored_pick.ids, ARRAY[]::text[]) AS "authoredDubIds",
           COALESCE(collection_summary.child_count, 0)::bigint AS "childCount",
           COALESCE(collection_summary.preview_items, '[]'::jsonb)
             AS "collectionPreviewItems",
           (
             EXISTS (
               SELECT 1 FROM video_study_question q
               WHERE q.video_id = v.id AND q.deleted_at IS NULL
                 AND q.text <> ''
             )
             OR EXISTS (
               SELECT 1 FROM bible_citation c
               WHERE c.video_id = v.id AND c.deleted_at IS NULL
             )
           ) AS "hasGrounding"
    FROM requested r
    JOIN video v ON v.id = r.video_id AND v.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT vl.title, vl.description
      FROM video_locale vl
      WHERE vl.video_id = v.id AND vl.deleted_at IS NULL AND vl.locale IS NOT NULL
      ORDER BY CASE
        WHEN lower(replace(vl.locale, '_', '-')) = ${normalizedLocale} THEN 0
        WHEN lower(replace(vl.locale, '_', '-')) = ${baseLocale} THEN 1
        WHEN lower(replace(vl.locale, '_', '-')) LIKE ${`${normalizedLocale}-%`} THEN 2
        WHEN lower(replace(vl.locale, '_', '-')) LIKE ${`${baseLocale}-%`} THEN 3
        ELSE 4
      END,
      vl.updated_at DESC NULLS LAST,
      vl.id ASC
      LIMIT 1
    ) locale_pick ON TRUE
    LEFT JOIN LATERAL (
      SELECT vi.url
      FROM video_image vi
      WHERE vi.video_id = v.id AND vi.deleted_at IS NULL
        AND NULLIF(btrim(vi.url), '') IS NOT NULL
      ORDER BY CASE vi.kind
        WHEN 'videoStill' THEN 0
        WHEN 'mobileCinematicHigh' THEN 1
        WHEN 'poster' THEN 2
        WHEN 'still' THEN 3
        ELSE 4
      END,
      vi.created_at ASC,
      vi.id ASC
      LIMIT 1
    ) image_pick ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS language_count,
             (array_agg(lw.id ORDER BY lw.updated_at DESC NULLS LAST, lw.id ASC))[1:${EXPERIENCE_EDITOR_LANGUAGE_CHIP_LIMIT}]
               AS chip_ids
      FROM language_winners lw
      WHERE lw.video_id = v.id
    ) dub_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.id
      FROM eligible_dubs e
      WHERE e.video_id = v.id
      ORDER BY CASE WHEN (
        lower(replace(COALESCE(e.bcp47, ''), '_', '-')) IN (${normalizedLocale}, ${baseLocale})
        OR lower(replace(COALESCE(e.language_slug, ''), '_', '-')) IN (${normalizedLocale}, ${baseLocale})
        OR lower(replace(COALESCE(e.iso3, ''), '_', '-')) IN (${normalizedLocale}, ${baseLocale})
        OR lower(replace(COALESCE(e.bcp47, ''), '_', '-')) LIKE ${`${baseLocale}-%`}
        OR lower(replace(COALESCE(e.language_slug, ''), '_', '-')) LIKE ${`${baseLocale}-%`}
      ) THEN 0 ELSE 1 END,
      CASE WHEN NULLIF(btrim(e.hls), '') IS NOT NULL THEN 0 ELSE 1 END,
      e.updated_at DESC NULLS LAST,
      e.id ASC
      LIMIT 1
    ) default_pick ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(resolved.id ORDER BY resolved.selector_order)
        FILTER (WHERE resolved.id IS NOT NULL) AS ids
      FROM (
        SELECT a.selector_order,
               COALESCE(
                 (
                   SELECT e.id FROM eligible_dubs e
                   WHERE e.video_id = a.video_id
                     AND a.language_id IS NOT NULL
                     AND e.language_id = a.language_id
                   ORDER BY e.updated_at DESC NULLS LAST, e.id ASC
                   LIMIT 1
                 ),
                 (
                   SELECT e.id FROM eligible_dubs e
                   WHERE e.video_id = a.video_id
                     AND a.legacy_streaming_url IS NOT NULL
                     AND a.legacy_streaming_url IN (
                       btrim(e.hls), btrim(e.dash), btrim(e.share)
                     )
                   ORDER BY e.updated_at DESC NULLS LAST, e.id ASC
                   LIMIT 1
                 )
               ) AS id
        FROM authored a
        WHERE a.video_id = v.id
      ) resolved
    ) authored_pick ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS child_count,
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'key', preview.child_id,
                   'title', COALESCE(preview.title, 'Untitled video'),
                   'previewImageUrl', preview.image_url
                 ) ORDER BY preview.preview_order
               ) FILTER (WHERE preview.preview_order <= 3),
               '[]'::jsonb
             ) AS preview_items
      FROM (
        SELECT relation.child_id,
               row_number() OVER (
                 ORDER BY relation.order ASC NULLS LAST,
                          relation.created_at ASC,
                          relation.id ASC
               ) AS preview_order,
               (
                 SELECT child_locale.title
                 FROM video_locale child_locale
                 WHERE child_locale.video_id = relation.child_id
                   AND child_locale.deleted_at IS NULL
                   AND child_locale.locale IS NOT NULL
                 ORDER BY CASE
                   WHEN lower(replace(child_locale.locale, '_', '-')) = ${normalizedLocale} THEN 0
                   WHEN lower(replace(child_locale.locale, '_', '-')) = ${baseLocale} THEN 1
                   ELSE 2
                 END,
                 child_locale.updated_at DESC NULLS LAST,
                 child_locale.id ASC
                 LIMIT 1
               ) AS title,
               (
                 SELECT child_image.url
                 FROM video_image child_image
                 WHERE child_image.video_id = relation.child_id
                   AND child_image.deleted_at IS NULL
                   AND NULLIF(btrim(child_image.url), '') IS NOT NULL
                 ORDER BY CASE child_image.kind
                   WHEN 'videoStill' THEN 0
                   WHEN 'mobileCinematicHigh' THEN 1
                   WHEN 'poster' THEN 2
                   WHEN 'still' THEN 3
                   ELSE 4
                 END,
                 child_image.created_at ASC,
                 child_image.id ASC
                 LIMIT 1
               ) AS image_url
        FROM video_relation relation
        JOIN video child ON child.id = relation.child_id
          AND child.deleted_at IS NULL
        WHERE relation.parent_id = v.id
      ) preview
    ) collection_summary ON TRUE
    ORDER BY r.requested_order ASC
  `)
}

async function hydrateSelectedEditorDubs(
  db: Pick<ExperienceEditorSummaryDb, "videoDub">,
  dubIds: readonly string[],
) {
  if (dubIds.length === 0) return []
  return db.videoDub.findMany({
    where: {
      id: { in: [...dubIds] },
      deletedAt: null,
      OR: [
        { hls: { not: null } },
        { dash: { not: null } },
        { share: { not: null } },
      ],
      video: { deletedAt: null },
    },
    include: {
      language: {
        select: {
          id: true,
          slug: true,
          bcp47: true,
          iso3: true,
          name: true,
          countryLanguages: {
            where: { deletedAt: null },
            orderBy: [
              { primary: "desc" },
              { suggested: "desc" },
              { order: "asc" },
              { speakers: "desc" },
              { id: "asc" },
            ],
            take: 1,
            select: {
              country: {
                select: { flagPngSrc: true, flagWebpSrc: true },
              },
            },
          },
        },
      },
    },
  }) as Promise<HydratedEditorDub[]>
}

function mapSummaryRows(
  rows: readonly ExperienceEditorSummarySelectionRow[],
  dubs: readonly HydratedEditorDub[],
  locale: string,
) {
  const dubsById = new Map(dubs.map((dub) => [dub.id, dub]))

  return rows.map((row): ExperienceEditorVideoSummary => {
    const defaultDub = row.defaultDubId
      ? (dubsById.get(row.defaultDubId) ?? null)
      : null
    const defaultChoice = defaultDub
      ? createExperienceEditorDubChoice(defaultDub, locale)
      : null
    const authoredDubs = uniqueNonemptyIds(row.authoredDubIds ?? []).flatMap(
      (dubId) => {
        const dub = dubsById.get(dubId)
        const choice = dub ? createExperienceEditorDubChoice(dub, locale) : null
        return choice ? [choice] : []
      },
    )
    const playableLanguageChips = uniqueNonemptyIds(
      row.chipDubIds ?? [],
    ).flatMap((dubId) => {
      const dub = dubsById.get(dubId)
      const chip = dub ? languageChip(dub) : null
      return chip ? [chip] : []
    })
    const playableLanguageCount = toSafeCount(row.playableLanguageCount)
    const source = summarySource(row.videoSource)
    const durationChoice = defaultChoice ?? authoredDubs[0] ?? null
    const childCount = toSafeCount(row.childCount)

    return {
      key: row.videoId,
      id: row.coreId,
      slug: row.slug,
      title: compactText(row.title) ?? row.slug,
      description: compactText(row.description),
      label: row.label,
      labelLabel: summaryVideoLabel(row.label, locale),
      childCount,
      isCollectionTarget:
        row.label === "COLLECTION" ||
        (row.label === "SERIES" && childCount > 0),
      sourceLabel: source.label,
      sourceTone: summarySourceTone(source.tone),
      dubs: coverageLabel(playableLanguageCount, playableLanguageChips),
      playableLanguageCount,
      playableLanguageChips,
      updated: formatSummaryDateTime(row.updatedAt),
      duration: durationChoice?.duration ?? "--:--",
      durationSeconds: durationChoice?.durationSeconds ?? null,
      previewImageUrl: normalizeSummaryImageUrl(row.previewImageUrl),
      previewStreamUrl: defaultChoice?.streamUrl ?? null,
      defaultDub: defaultChoice,
      authoredDubs,
      dubInventory: NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY,
      hasGrounding: row.hasGrounding,
      collectionPreviewItems: normalizedCollectionPreviewItems(
        row.collectionPreviewItems,
      ).map((item) => ({
        ...item,
        previewImageUrl: normalizeSummaryImageUrl(item.previewImageUrl),
      })),
    }
  })
}

async function loadExperienceEditorVideoSummaryBatch(
  db: ExperienceEditorSummaryDb,
  request: ExperienceEditorVideoSummaryRequest,
) {
  const videoIds = uniqueNonemptyIds(request.videoIds)
  if (videoIds.length > EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE) {
    throw new RangeError("Experience editor video batch exceeds its limit")
  }
  const rows = await selectExperienceEditorSummaryRows(
    db,
    videoIds,
    request.locale,
    request.authoredSelectors ?? [],
  )
  const dubs = await hydrateSelectedEditorDubs(db, selectedDubIds(rows))
  return mapSummaryRows(rows, dubs, request.locale)
}

/**
 * Hydrates exactly the requested IDs, in first-occurrence order. Missing and
 * deleted videos are omitted; zero-playable videos remain as empty summaries.
 */
export async function loadExperienceEditorVideoSummariesByIds(
  db: ExperienceEditorSummaryDb,
  request: ExperienceEditorVideoSummaryRequest,
) {
  const videoIds = uniqueNonemptyIds(request.videoIds)
  const summaries: ExperienceEditorVideoSummary[] = []
  for (
    let offset = 0;
    offset < videoIds.length;
    offset += EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE
  ) {
    const batchIds = videoIds.slice(
      offset,
      offset + EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE,
    )
    summaries.push(
      ...(await loadExperienceEditorVideoSummaryBatch(db, {
        ...request,
        videoIds: batchIds,
      })),
    )
  }
  return summaries
}

/** List projection for IDs already selected by the catalog query. */
export async function loadExperienceEditorVideoSummaryList(
  db: ExperienceEditorSummaryDb,
  request: ExperienceEditorVideoSummaryRequest,
) {
  return loadExperienceEditorVideoSummariesByIds(db, request)
}
import { Prisma, type PrismaClient } from "@prisma/client"

export const EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE = 100
export const EXPERIENCE_EDITOR_LANGUAGE_CHIP_LIMIT = 5
export const EXPERIENCE_EDITOR_DUB_PAGE_DEFAULT_SIZE = 50
export const EXPERIENCE_EDITOR_DUB_PAGE_MAX_SIZE = 100

export class ExperienceEditorVideoInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExperienceEditorVideoInputError"
  }
}

export class ExperienceEditorVideoNotFoundError extends Error {
  constructor(videoId: string) {
    super(`Experience editor video ${videoId} was not found.`)
    this.name = "ExperienceEditorVideoNotFoundError"
  }
}

type ExperienceEditorLookupDb = Pick<
  PrismaClient,
  "$queryRaw" | "video" | "videoDub"
>

export type ExperienceEditorDubPageRequest = {
  videoId: string
  locale: string
  query?: string
  cursor?: string | null
  pageSize?: number
  selectedLanguageId?: string | null
  selectedLegacyStreamingUrl?: string | null
}

export type ExperienceEditorDubPageActionInput = Omit<
  ExperienceEditorDubPageRequest,
  "locale"
>

export type ExperienceEditorDubPage = {
  choices: ExperienceEditorDubChoice[]
  selectedChoice: ExperienceEditorDubChoice | null
  nextCursor: string | null
}

type DubPageCursor = {
  v: 1
  videoId: string
  locale: string
  query: string
  sortLabel: string
  languageIdentity: string
  dubId: string
}

type DubPageRow = {
  id: string
  videoId: string
  languageId: string | null
  languageSlug: string | null
  bcp47: string | null
  iso3: string | null
  languageName: string | null
  hls: string | null
  dash: string | null
  share: string | null
  duration: number | null
  lengthInMilliseconds: bigint | null
  updatedAt: Date
  languageIdentity: string
  sortLabel: string
}

function normalizedLookupLocale(locale: string) {
  return locale.trim().toLowerCase().replaceAll("_", "-")
}

function normalizedLookupQuery(query: string | null | undefined) {
  return query?.trim().toLocaleLowerCase() ?? ""
}

function normalizedPageSize(value: number | undefined) {
  if (value === undefined) return EXPERIENCE_EDITOR_DUB_PAGE_DEFAULT_SIZE
  if (!Number.isInteger(value) || value <= 0) {
    throw new ExperienceEditorVideoInputError(
      "Page size must be a positive integer.",
    )
  }
  return Math.min(value, EXPERIENCE_EDITOR_DUB_PAGE_MAX_SIZE)
}

function encodeOpaqueCursor(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function parseDubPageCursor(
  value: string | null | undefined,
  identity: Pick<DubPageCursor, "videoId" | "locale" | "query">,
): DubPageCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<DubPageCursor>
    if (
      decoded.v !== 1 ||
      decoded.videoId !== identity.videoId ||
      decoded.locale !== identity.locale ||
      decoded.query !== identity.query ||
      typeof decoded.sortLabel !== "string" ||
      typeof decoded.languageIdentity !== "string" ||
      typeof decoded.dubId !== "string"
    ) {
      throw new Error("cursor identity mismatch")
    }
    return decoded as DubPageCursor
  } catch {
    throw new ExperienceEditorVideoInputError(
      "Invalid or mismatched experience editor cursor.",
    )
  }
}

async function assertEditorVideoExists(
  db: Pick<ExperienceEditorLookupDb, "video">,
  videoId: string,
) {
  const video = await db.video.findFirst({
    where: { id: videoId, deletedAt: null },
    select: { id: true },
  })
  if (!video) throw new ExperienceEditorVideoNotFoundError(videoId)
}

function dubChoiceFromPageRow(row: DubPageRow, locale: string) {
  return createExperienceEditorDubChoice(
    {
      id: row.id,
      videoId: row.videoId,
      languageId: row.languageId,
      language: row.languageId
        ? {
            id: row.languageId,
            slug: row.languageSlug,
            bcp47: row.bcp47,
            iso3: row.iso3,
            name: row.languageName ? { [locale]: row.languageName } : {},
          }
        : null,
      hls: row.hls,
      dash: row.dash,
      share: row.share,
      duration: row.duration,
      lengthInMilliseconds: row.lengthInMilliseconds,
      deletedAt: null,
      updatedAt: row.updatedAt,
    },
    locale,
  )
}

function dubPageProjection(
  videoId: string,
  locale: string,
  query: string,
  cursor: DubPageCursor | null,
  take: number,
) {
  const baseLocale = locale.split("-")[0] ?? locale
  const searchPattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
  const cursorPredicate = !cursor
    ? Prisma.empty
    : Prisma.sql`
        AND ("sortLabel", "languageIdentity", id) >
          (${cursor.sortLabel}, ${cursor.languageIdentity}, ${cursor.dubId})
      `
  return Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT d.id, d.video_id AS "videoId", d.language_id AS "languageId",
             l.slug AS "languageSlug", l.bcp47, l.iso3,
             COALESCE(
               localized.value,
               NULLIF(l.name ->> ${locale}, ''), NULLIF(l.name ->> ${baseLocale}, ''),
               NULLIF(l.name ->> 'en', ''), NULLIF(l.slug, ''), NULLIF(l.bcp47, ''),
               NULLIF(l.iso3, ''), d.id) AS "languageName",
             d.hls, d.dash, d.share, d.duration,
             d.length_in_milliseconds AS "lengthInMilliseconds",
             d.updated_at AS "updatedAt",
             COALESCE(NULLIF(lower(btrim(l.slug)), ''), NULLIF(lower(btrim(l.bcp47)), ''),
               NULLIF(lower(btrim(l.iso3)), ''), NULLIF(lower(btrim(COALESCE(l.id, d.language_id))), ''), d.id)
               AS "languageIdentity",
             lower(COALESCE(localized.value, NULLIF(l.name ->> ${locale}, ''), NULLIF(l.name ->> ${baseLocale}, ''),
               NULLIF(l.name ->> 'en', ''), NULLIF(l.slug, ''), NULLIF(l.bcp47, ''),
               NULLIF(l.iso3, ''), d.id)) AS "sortLabel",
             concat_ws(' ', localized.value, l.name ->> ${locale}, l.name ->> ${baseLocale}, l.name ->> 'en',
               l.slug, l.bcp47, l.iso3,
               concat(COALESCE(d.duration::bigint, d.length_in_milliseconds / 1000, 0) / 60, ':',
                 lpad((COALESCE(d.duration::bigint, d.length_in_milliseconds / 1000, 0) % 60)::text, 2, '0')))
               AS duration_text,
             row_number() OVER (
               PARTITION BY COALESCE(NULLIF(lower(btrim(l.slug)), ''), NULLIF(lower(btrim(l.bcp47)), ''),
                 NULLIF(lower(btrim(l.iso3)), ''), NULLIF(lower(btrim(COALESCE(l.id, d.language_id))), ''), d.id)
               ORDER BY d.updated_at DESC NULLS LAST, d.id ASC) AS language_rank
      FROM video_dub d
      LEFT JOIN language l ON l.id = d.language_id AND l.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT ll.value
        FROM language_locale ll
        WHERE ll.language_id = l.id AND ll.deleted_at IS NULL
        ORDER BY CASE
          WHEN lower(replace(ll.locale, '_', '-')) = ${locale} THEN 0
          WHEN lower(replace(ll.locale, '_', '-')) = ${baseLocale} THEN 1
          ELSE 2 END,
          ll.primary DESC, ll.order ASC NULLS LAST, ll.id ASC
        LIMIT 1
      ) localized ON TRUE
      WHERE d.video_id = ${videoId} AND d.deleted_at IS NULL
        AND COALESCE(NULLIF(btrim(d.hls), ''), NULLIF(btrim(d.dash), ''), NULLIF(btrim(d.share), '')) IS NOT NULL
    ), winners AS MATERIALIZED (
      SELECT * FROM eligible WHERE language_rank = 1
    )
    SELECT id, "videoId", "languageId", "languageSlug", bcp47, iso3,
           "languageName", hls, dash, share, duration, "lengthInMilliseconds",
           "updatedAt", "languageIdentity", "sortLabel"
    FROM winners
    WHERE (${query} = '' OR duration_text ILIKE ${searchPattern} ESCAPE '\\')
      ${cursorPredicate}
    ORDER BY "sortLabel" ASC, "languageIdentity" ASC, id ASC
    LIMIT ${take}
  `
}

async function selectExactDubChoice(
  db: Pick<ExperienceEditorLookupDb, "$queryRaw">,
  request: ExperienceEditorDubPageRequest,
  locale: string,
) {
  const languageId = compactText(request.selectedLanguageId)
  const legacyUrl = compactText(request.selectedLegacyStreamingUrl)
  if (!languageId && !legacyUrl) return null
  const selectorPredicate = languageId
    ? Prisma.sql`d.language_id = ${languageId}`
    : Prisma.sql`${legacyUrl} IN (btrim(d.hls), btrim(d.dash), btrim(d.share))`
  const rows = await db.$queryRaw<DubPageRow[]>(Prisma.sql`
    SELECT d.id, d.video_id AS "videoId", d.language_id AS "languageId",
           l.slug AS "languageSlug", l.bcp47, l.iso3,
           COALESCE(l.name ->> ${locale}, l.name ->> 'en', l.slug, l.bcp47, l.iso3, d.id) AS "languageName",
           d.hls, d.dash, d.share, d.duration, d.length_in_milliseconds AS "lengthInMilliseconds",
           d.updated_at AS "updatedAt",
           COALESCE(NULLIF(lower(btrim(l.slug)), ''), NULLIF(lower(btrim(l.bcp47)), ''),
             NULLIF(lower(btrim(l.iso3)), ''), NULLIF(lower(btrim(COALESCE(l.id, d.language_id))), ''), d.id)
             AS "languageIdentity",
           lower(COALESCE(l.name ->> ${locale}, l.name ->> 'en', l.slug, l.bcp47, l.iso3, d.id)) AS "sortLabel"
    FROM video_dub d
    LEFT JOIN language l ON l.id = d.language_id AND l.deleted_at IS NULL
    JOIN video v ON v.id = d.video_id AND v.deleted_at IS NULL
    WHERE d.video_id = ${request.videoId} AND d.deleted_at IS NULL
      AND COALESCE(NULLIF(btrim(d.hls), ''), NULLIF(btrim(d.dash), ''), NULLIF(btrim(d.share), '')) IS NOT NULL
      AND ${selectorPredicate}
    ORDER BY d.updated_at DESC NULLS LAST, d.id ASC LIMIT 1
  `)
  const row = rows[0]
  return row ? dubChoiceFromPageRow(row, request.locale) : null
}

export async function loadExperienceEditorDubPage(
  db: ExperienceEditorLookupDb,
  request: ExperienceEditorDubPageRequest,
): Promise<ExperienceEditorDubPage> {
  const videoId = compactText(request.videoId)
  if (!videoId)
    throw new ExperienceEditorVideoInputError("Video id is required.")
  const locale = normalizedLookupLocale(request.locale)
  if (!locale) throw new ExperienceEditorVideoInputError("Locale is required.")
  const query = normalizedLookupQuery(request.query)
  const pageSize = normalizedPageSize(request.pageSize)
  const cursor = parseDubPageCursor(request.cursor, { videoId, locale, query })
  await assertEditorVideoExists(db, videoId)
  const rows = await db.$queryRaw<DubPageRow[]>(
    dubPageProjection(videoId, locale, query, cursor, pageSize + 1),
  )
  const pageRows = rows.slice(0, pageSize)
  const lastRow = pageRows.at(-1)
  const nextCursor =
    rows.length > pageSize && lastRow
      ? encodeOpaqueCursor({
          v: 1,
          videoId,
          locale,
          query,
          sortLabel: lastRow.sortLabel,
          languageIdentity: lastRow.languageIdentity,
          dubId: lastRow.id,
        } satisfies DubPageCursor)
      : null
  const selectedChoice = await selectExactDubChoice(db, request, locale)
  return {
    choices: pageRows.flatMap((row) => {
      const choice = dubChoiceFromPageRow(row, request.locale)
      return choice ? [choice] : []
    }),
    selectedChoice,
    nextCursor,
  }
}

export type ExperienceEditorCollectionChildPageRequest = {
  parentVideoId: string
  locale: string
  cursor?: string | null
  pageSize?: number
  authoredSelectors?: readonly ExperienceEditorAuthoredDubSelector[]
}
export type ExperienceEditorCollectionChildPageActionInput = Omit<
  ExperienceEditorCollectionChildPageRequest,
  "locale" | "authoredSelectors"
>
export type ExperienceEditorCollectionChildPage = {
  items: ExperienceEditorVideoSummary[]
  nextCursor: string | null
  total: number
}
type CollectionCursor = {
  v: 1
  parentVideoId: string
  order: number | null
  createdAt: string
  relationId: string
}
type CollectionRelationRow = {
  relationId: string
  childId: string
  order: number | null
  createdAt: string
}

function parseCollectionCursor(
  value: string | null | undefined,
  parentVideoId: string,
): CollectionCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CollectionCursor>
    if (
      decoded.v !== 1 ||
      decoded.parentVideoId !== parentVideoId ||
      (decoded.order !== null && !Number.isInteger(decoded.order)) ||
      typeof decoded.createdAt !== "string" ||
      !Number.isFinite(Date.parse(decoded.createdAt)) ||
      typeof decoded.relationId !== "string"
    )
      throw new Error("cursor identity mismatch")
    return decoded as CollectionCursor
  } catch {
    throw new ExperienceEditorVideoInputError(
      "Invalid or mismatched collection cursor.",
    )
  }
}

export async function loadExperienceEditorCollectionChildPage(
  db: ExperienceEditorLookupDb,
  request: ExperienceEditorCollectionChildPageRequest,
): Promise<ExperienceEditorCollectionChildPage> {
  const parentVideoId = compactText(request.parentVideoId)
  if (!parentVideoId)
    throw new ExperienceEditorVideoInputError("Parent video id is required.")
  const pageSize = normalizedPageSize(request.pageSize)
  const cursor = parseCollectionCursor(request.cursor, parentVideoId)
  await assertEditorVideoExists(db, parentVideoId)
  const cursorPredicate = !cursor
    ? Prisma.empty
    : cursor.order === null
      ? Prisma.sql`
        AND relation.order IS NULL
        AND (
          relation.created_at > ${cursor.createdAt}::timestamptz
          OR (relation.created_at = ${cursor.createdAt}::timestamptz AND relation.id > ${cursor.relationId})
        )
      `
      : Prisma.sql`
        AND (
          relation.order > ${cursor.order}
          OR (relation.order = ${cursor.order} AND relation.created_at > ${cursor.createdAt}::timestamptz)
          OR (relation.order = ${cursor.order} AND relation.created_at = ${cursor.createdAt}::timestamptz AND relation.id > ${cursor.relationId})
          OR relation.order IS NULL
        )
      `
  const envelopes = await db.$queryRaw<
    Array<{ relationRows: unknown; total: bigint | number }>
  >(Prisma.sql`
    WITH page AS (
      SELECT relation.id AS "relationId", relation.child_id AS "childId",
             relation.order, relation.created_at AS "createdAt"
      FROM video_relation relation
      JOIN video child ON child.id = relation.child_id AND child.deleted_at IS NULL
      WHERE relation.parent_id = ${parentVideoId}
        ${cursorPredicate}
      ORDER BY relation.order ASC NULLS LAST, relation.created_at ASC, relation.id ASC
      LIMIT ${pageSize + 1}
    )
    SELECT COALESCE(jsonb_agg(page ORDER BY page.order ASC NULLS LAST, page."createdAt" ASC, page."relationId" ASC), '[]'::jsonb) AS "relationRows",
      (SELECT count(*)::bigint FROM video_relation relation
       JOIN video child ON child.id = relation.child_id AND child.deleted_at IS NULL
       WHERE relation.parent_id = ${parentVideoId}) AS total
    FROM page
  `)
  const envelope = envelopes[0]
  const relationRows = Array.isArray(envelope?.relationRows)
    ? (envelope.relationRows as CollectionRelationRow[])
    : []
  const pageRows = relationRows.slice(0, pageSize)
  const lastRow = pageRows.at(-1)
  const nextCursor =
    relationRows.length > pageSize && lastRow
      ? encodeOpaqueCursor({
          v: 1,
          parentVideoId,
          order: lastRow.order,
          // Preserve PostgreSQL's full timestamp precision. Converting through
          // Date truncates microseconds and can make the last row reappear on
          // the next keyset page.
          createdAt: lastRow.createdAt,
          relationId: lastRow.relationId,
        } satisfies CollectionCursor)
      : null
  const items = await loadExperienceEditorVideoSummariesByIds(db, {
    videoIds: pageRows.map((row) => row.childId),
    locale: request.locale,
    authoredSelectors: request.authoredSelectors,
  })
  return {
    items,
    nextCursor,
    total: envelope ? toSafeCount(envelope.total) : 0,
  }
}

export type ExperienceEditorDubSelectionValidationRequest = {
  selectors: readonly ExperienceEditorAuthoredDubSelector[]
  previousSelectors?: readonly ExperienceEditorAuthoredDubSelector[]
  locale: string
}
export type ExperienceEditorDubSelectionValidationActionInput = Omit<
  ExperienceEditorDubSelectionValidationRequest,
  "locale" | "previousSelectors"
>
export type ExperienceEditorDubSelectionValidation = {
  available: Array<{
    selector: ExperienceEditorAuthoredDubSelector
    choice: ExperienceEditorDubChoice
  }>
  unavailable: Array<{
    selector: ExperienceEditorAuthoredDubSelector
    preExisting: boolean
    reason: "video-or-dub-unavailable"
  }>
}
type ValidationRow = DubPageRow & { selectorIndex: number }

function selectorIdentity(selector: ExperienceEditorAuthoredDubSelector) {
  const languageId = compactText(selector.languageId)
  const legacyUrl = compactText(selector.legacyStreamingUrl)
  return languageId
    ? `${selector.videoId}\u0000language\u0000${languageId}`
    : `${selector.videoId}\u0000stream\u0000${legacyUrl ?? ""}`
}

export async function validateExperienceEditorDubSelections(
  db: Pick<ExperienceEditorLookupDb, "$queryRaw">,
  request: ExperienceEditorDubSelectionValidationRequest,
): Promise<ExperienceEditorDubSelectionValidation> {
  const selectors = request.selectors.filter(
    (selector) =>
      compactText(selector.videoId) != null &&
      (compactText(selector.languageId) != null ||
        compactText(selector.legacyStreamingUrl) != null),
  )
  const previous = new Set(
    (request.previousSelectors ?? []).map(selectorIdentity),
  )
  const available: ExperienceEditorDubSelectionValidation["available"] = []
  const unavailable: ExperienceEditorDubSelectionValidation["unavailable"] = []
  for (
    let offset = 0;
    offset < selectors.length;
    offset += EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE
  ) {
    const batch = selectors.slice(
      offset,
      offset + EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE,
    )
    const inputJson = JSON.stringify(
      batch.map((selector, selectorIndex) => ({
        selector_index: selectorIndex,
        video_id: selector.videoId,
        language_id: compactText(selector.languageId),
        legacy_streaming_url: compactText(selector.legacyStreamingUrl),
      })),
    )
    const rows = await db.$queryRaw<ValidationRow[]>(Prisma.sql`
      WITH requested AS MATERIALIZED (
        SELECT input.selector_index, input.video_id, input.language_id, input.legacy_streaming_url
        FROM jsonb_to_recordset(${inputJson}::jsonb)
          AS input(selector_index integer, video_id text, language_id text, legacy_streaming_url text)
      )
      SELECT requested.selector_index AS "selectorIndex", selected.id,
             selected.video_id AS "videoId", selected.language_id AS "languageId",
             selected.language_slug AS "languageSlug", selected.bcp47, selected.iso3,
             selected.language_name AS "languageName", selected.hls, selected.dash, selected.share,
             selected.duration, selected.length_in_milliseconds AS "lengthInMilliseconds",
             selected.updated_at AS "updatedAt", selected.language_identity AS "languageIdentity",
             selected.sort_label AS "sortLabel"
      FROM requested
      JOIN LATERAL (
        SELECT d.*, l.slug AS language_slug, l.bcp47, l.iso3,
          COALESCE(l.name ->> ${request.locale}, l.name ->> 'en', l.slug, l.bcp47, l.iso3, d.id) AS language_name,
          COALESCE(NULLIF(lower(btrim(l.slug)), ''), NULLIF(lower(btrim(l.bcp47)), ''),
            NULLIF(lower(btrim(l.iso3)), ''), NULLIF(lower(btrim(COALESCE(l.id, d.language_id))), ''), d.id) AS language_identity,
          lower(COALESCE(l.name ->> ${request.locale}, l.name ->> 'en', l.slug, l.bcp47, l.iso3, d.id)) AS sort_label
        FROM video_dub d JOIN video v ON v.id = d.video_id AND v.deleted_at IS NULL
        LEFT JOIN language l ON l.id = d.language_id AND l.deleted_at IS NULL
        WHERE d.video_id = requested.video_id AND d.deleted_at IS NULL
          AND COALESCE(NULLIF(btrim(d.hls), ''), NULLIF(btrim(d.dash), ''), NULLIF(btrim(d.share), '')) IS NOT NULL
          AND ((requested.language_id IS NOT NULL AND d.language_id = requested.language_id)
            OR (requested.language_id IS NULL AND requested.legacy_streaming_url IS NOT NULL
              AND requested.legacy_streaming_url IN (btrim(d.hls), btrim(d.dash), btrim(d.share))))
        ORDER BY d.updated_at DESC NULLS LAST, d.id ASC LIMIT 1
      ) selected ON TRUE ORDER BY requested.selector_index ASC
    `)
    const byIndex = new Map(rows.map((row) => [row.selectorIndex, row]))
    for (const [selectorIndex, selector] of batch.entries()) {
      const row = byIndex.get(selectorIndex)
      const choice = row ? dubChoiceFromPageRow(row, request.locale) : null
      if (choice) available.push({ selector, choice })
      else
        unavailable.push({
          selector,
          preExisting: previous.has(selectorIdentity(selector)),
          reason: "video-or-dub-unavailable",
        })
    }
  }
  return { available, unavailable }
}
