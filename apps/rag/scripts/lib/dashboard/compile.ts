/**
 * Pure compile step for the status dashboard. No I/O — the CLI
 * (scripts/dashboard-compile.ts) reads/writes files and calls these.
 *
 * The evaluate rule (the one piece of real logic): a (source × language) row is
 *   evaluate = acquire(prod) AND ingest(prod) AND yaml.stages.evaluate === green
 * Acquire/ingest are prod-verified; the yaml green flag is the engineer's
 * shipped-via-PR signal that source-quality evaluation actually happened.
 */
import {
  sourceMapSchema,
  type CompiledChip,
  type CompiledData,
  type CompiledDocumentedRow,
  type CompiledRow,
  type CompiledSourceRow,
  type CompiledUnclassifiedRow,
  type ParsedSourceMap,
  type ProdStatusData,
  type RegistrySource,
  type SourceMap,
  type YamlSources,
  type YamlSource,
} from "./types.js"

export interface BuildInput {
  prod: ProdStatusData
  yaml: YamlSources
  registry: RegistrySource[]
  /** Curated gaps + documented-only sources (docs/source-map.yaml, #100). */
  sourceMap?: SourceMap
}

const SEP = "\u0000"
const cell = (key: string, language: string): string =>
  `${key}${SEP}${language}`

type RowStatus = CompiledRow["row_status"]
const ROW_STATUSES: readonly RowStatus[] = [
  "in-progress",
  "blocked",
  "done",
  "deferred",
]
function asRowStatus(value: string | undefined): RowStatus {
  return (ROW_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as RowStatus)
    : "unknown"
}

/** The canonical (key × language) universe: registry ∪ yaml ∪ prod-ingested. */
function canonicalCells(
  input: BuildInput,
): Array<{ key: string; language: string }> {
  const seen = new Map<string, { key: string; language: string }>()
  const documented = new Set(
    Object.keys(sourceMapSchema.parse(input.sourceMap ?? {}).documented),
  )
  const add = (key: string, language: string): void => {
    const id = cell(key, language)
    if (!seen.has(id)) seen.set(id, { key, language })
  }
  for (const s of input.registry)
    if (!documented.has(s.key)) for (const lang of s.languages) add(s.key, lang)
  for (const [key, src] of Object.entries(input.yaml))
    for (const lang of Object.keys(src.languages)) add(key, lang)
  for (const r of input.prod.ingested) add(r.key, r.language)
  return [...seen.values()]
}

export function buildCompiledData(input: BuildInput): CompiledData {
  const { prod, yaml, registry } = input
  const acquired = new Set(prod.acquired_keys)
  const registryByKey = new Map(registry.map((s) => [s.key, s]))
  const canonicalKeys = new Set(registryByKey.keys())
  for (const key of [
    ...prod.acquired_keys,
    ...prod.ingested.map((row) => row.key),
    ...prod.unclassified.map((row) => row.key),
  ]) {
    if (!canonicalKeys.has(key))
      throw new Error(
        `dashboard input references unknown canonical source: ${key}`,
      )
  }
  const ingestedByCell = new Map(
    prod.ingested.map((r) => [cell(r.key, r.language), r]),
  )

  const rows: CompiledRow[] = canonicalCells(input).map(({ key, language }) => {
    const reg = registryByKey.get(key)
    const yamlSrc: YamlSource | undefined = yaml[key]
    const yamlLang = yamlSrc?.languages[language]
    const ingestedRow = ingestedByCell.get(cell(key, language))

    const acquire = acquired.has(key) || ingestedRow !== undefined
    const ingest = ingestedRow !== undefined
    const evaluate = acquire && ingest && (yamlLang?.evaluateGreen ?? false)

    return {
      source: reg?.name ?? yamlSrc?.name ?? ingestedRow?.name ?? key,
      key,
      host: reg?.domain ?? ingestedRow?.host ?? null,
      language,
      acquire,
      ingest,
      evaluate,
      embedded_doc_count: ingestedRow?.embedded_doc_count ?? 0,
      row_status: asRowStatus(yamlLang?.status ?? yamlSrc?.status),
      note: yamlLang?.note ?? null,
    }
  })

  rows.sort(
    (a, b) =>
      a.source.toLowerCase().localeCompare(b.source.toLowerCase()) ||
      a.key.localeCompare(b.key) ||
      a.language.localeCompare(b.language),
  )

  // Unclassified tally (#86): resolve display name/host from the registry (same
  // preference as the main rows) and sort by count desc, then name.
  const unclassified: CompiledUnclassifiedRow[] = prod.unclassified
    .map((u) => {
      const reg = registryByKey.get(u.key)
      return {
        source: reg?.name ?? u.name ?? u.key,
        key: u.key,
        host: reg?.domain ?? u.host ?? null,
        embedded_doc_count: u.embedded_doc_count,
      }
    })
    .sort(
      (a, b) =>
        b.embedded_doc_count - a.embedded_doc_count ||
        a.source.toLowerCase().localeCompare(b.source.toLowerCase()),
    )

  const sourceMap = sourceMapSchema.parse(input.sourceMap ?? {})
  for (const key of Object.keys(sourceMap.gaps)) {
    if (!canonicalKeys.has(key))
      throw new Error(
        `source map gap references unknown canonical source: ${key}`,
      )
  }
  const source_rows = buildSourceRows(rows, unclassified, sourceMap)
  const documented = buildDocumented(sourceMap)

  return {
    schema_version: 1,
    provenance: {
      target: prod.target,
      fetched_at: prod.fetched_at,
      source_commit: prod.source_commit,
      schema_digest: prod.schema_digest,
    },
    sources: rows,
    source_rows,
    documented,
    unclassified,
  }
}

// ── Ledger grouping (#100): one row per source, languages as chips ───────────

/** Furthest stage a (source × language) cell reached, as a chip state. Prod
 *  facts (evaluate/ingest) outrank the yaml status; a cell with nothing in prod
 *  falls back to blocked (yaml) → acquired → proposed. */
function chipState(row: CompiledRow): CompiledChip["state"] {
  if (row.evaluate) return "evaluated"
  if (row.ingest) return "ingested"
  if (row.row_status === "blocked") return "blocked"
  if (row.acquire) return "acquired"
  return "proposed"
}

const SOURCE_STATES = ["evaluated", "ingested", "acquired", "blocked"] as const

function buildSourceRows(
  rows: CompiledRow[],
  unclassified: CompiledUnclassifiedRow[],
  sourceMap: ParsedSourceMap,
): CompiledSourceRow[] {
  const byKey = new Map<string, CompiledRow[]>()
  for (const row of rows) {
    const list = byKey.get(row.key) ?? []
    list.push(row)
    byKey.set(row.key, list)
  }
  const unclassifiedByKey = new Map(unclassified.map((row) => [row.key, row]))
  for (const row of unclassified) {
    if (!byKey.has(row.key)) byKey.set(row.key, [])
  }

  const out: CompiledSourceRow[] = []
  for (const [key, cells] of byKey) {
    const gap = sourceMap.gaps[key]
    const unclassifiedRow = unclassifiedByKey.get(key)

    const chips: CompiledChip[] = cells
      .map((c) => ({
        label: c.language,
        language: c.language,
        state: chipState(c),
        embedded_doc_count: c.ingest ? c.embedded_doc_count : null,
        detail: null,
      }))
      .sort(
        (a, b) =>
          (b.embedded_doc_count ?? -1) - (a.embedded_doc_count ?? -1) ||
          a.label.localeCompare(b.label),
      )
    for (const p of gap?.pending ?? []) {
      chips.push({
        label: p.label,
        language: null,
        state: p.state,
        embedded_doc_count: null,
        detail: p.detail,
      })
    }

    const docs =
      cells.reduce((n, c) => n + c.embedded_doc_count, 0) +
      (unclassifiedRow?.embedded_doc_count ?? 0)
    const cellStates = new Set(cells.map(chipState))
    if (unclassifiedRow) cellStates.add("ingested")
    const state =
      SOURCE_STATES.find((s) => cellStates.has(s)) ?? ("not-started" as const)
    const group: CompiledSourceRow["group"] =
      docs > 0 ? "production" : state === "blocked" ? "blocked" : "pipeline"

    out.push({
      source: cells[0]?.source ?? unclassifiedRow?.source ?? key,
      key,
      host: cells[0]?.host ?? unclassifiedRow?.host ?? gap?.host ?? null,
      state,
      group,
      languages: chips,
      docs_in_prod: docs,
      missing: gap?.missing ?? null,
    })
  }

  const GROUP_ORDER: Record<CompiledSourceRow["group"], number> = {
    production: 0,
    blocked: 1,
    pipeline: 2,
  }
  out.sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      b.docs_in_prod - a.docs_in_prod ||
      a.source.toLowerCase().localeCompare(b.source.toLowerCase()) ||
      a.key.localeCompare(b.key),
  )
  return out
}

function buildDocumented(sourceMap: ParsedSourceMap): CompiledDocumentedRow[] {
  return Object.entries(sourceMap.documented)
    .map(([key, d]) => ({
      source: d.name,
      key,
      host: d.host,
      state: d.state,
      method: d.method,
      languages: d.languages,
      est_size: d.est_size,
      note: d.note,
    }))
    .sort(
      (a, b) =>
        (a.state === b.state ? 0 : a.state === "proposed" ? -1 : 1) ||
        a.source.toLowerCase().localeCompare(b.source.toLowerCase()) ||
        a.key.localeCompare(b.key),
    )
}

export { renderHtml } from "./render.js"
export { assertHtmlContainsData, assertHtmlMatchesTemplate } from "./verify.js"
