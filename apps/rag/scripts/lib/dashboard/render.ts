import type {
  CompiledChip,
  CompiledData,
  CompiledDocumentedRow,
  CompiledSourceRow,
  CompiledUnclassifiedRow,
} from "./types.js"

// ── HTML rendering ───────────────────────────────────────────────────────────

const ROWS_PLACEHOLDER = "<!-- DASHBOARD_ROWS -->"
const DATE_PLACEHOLDER = "<!-- DASHBOARD_GENERATED_AT -->"
const SUMMARY_PLACEHOLDER = "<!-- DASHBOARD_SUMMARY -->"
const UNCLASSIFIED_PLACEHOLDER = "<!-- DASHBOARD_UNCLASSIFIED -->"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Chip state → glyph. The glyph rides inside the chip so state is never
 *  color-alone; evaluated is the terminal state and carries no glyph. */
const CHIP_GLYPH: Record<CompiledChip["state"], string> = {
  evaluated: "",
  ingested: "◐",
  acquired: "○",
  blocked: "✕",
  proposed: "⋯",
}

function renderChip(row: CompiledSourceRow, chip: CompiledChip): string {
  const idAttr =
    chip.language !== null
      ? `data-language="${escapeHtml(chip.language)}"`
      : `data-pending-label="${escapeHtml(chip.label)}"`
  const glyph = CHIP_GLYPH[chip.state]
    ? `<span class="g">${CHIP_GLYPH[chip.state]}</span>`
    : ""
  const count =
    chip.embedded_doc_count !== null
      ? `<span class="n">${chip.embedded_doc_count.toLocaleString("en-US")}</span>`
      : ""
  const detail = chip.detail
    ? `<span class="n">${escapeHtml(chip.detail)}</span>`
    : ""
  return [
    `<span class="chip chip-${chip.state}" data-key="${escapeHtml(row.key)}" ${idAttr}>`,
    glyph,
    `<span class="l">${escapeHtml(chip.label)}</span>`,
    count,
    detail,
    `</span>`,
  ].join("")
}

const STATE_LABEL: Record<
  CompiledSourceRow["state"] | CompiledDocumentedRow["state"],
  string
> = {
  evaluated: "Evaluated",
  ingested: "Ingested",
  acquired: "Acquired",
  blocked: "Blocked",
  "not-started": "Not started",
  proposed: "Proposed",
  retired: "Retired",
}

function sourceCell(name: string, host: string | null): string {
  const hostText = host ? escapeHtml(host) : "—"
  return `<td class="col-source"><span class="source-name">${escapeHtml(name)}</span><span class="source-host">${hostText}</span></td>`
}

function statePill(state: keyof typeof STATE_LABEL): string {
  return `<span class="stage stage-${state}">${STATE_LABEL[state]}</span>`
}

function renderSourceRow(row: CompiledSourceRow): string {
  const chips = row.languages.map((c) => renderChip(row, c)).join("")
  const missing = row.missing ? escapeHtml(row.missing) : `<em>—</em>`
  return [
    `<tr data-key="${escapeHtml(row.key)}" class="row-${row.group} state-${row.state}">`,
    sourceCell(row.source, row.host),
    `<td class="col-state">${statePill(row.state)}</td>`,
    `<td class="col-langs"><div class="chips">${chips}</div></td>`,
    `<td class="col-count">${row.docs_in_prod.toLocaleString("en-US")}</td>`,
    `<td class="col-missing">${missing}</td>`,
    `</tr>`,
  ].join("")
}

function renderDocumentedRow(row: CompiledDocumentedRow): string {
  const chip = [
    `<span class="chip chip-proposed"><span class="g">⋯</span>`,
    `<span class="l">${escapeHtml(row.languages)}</span>`,
    `<span class="n">${escapeHtml(row.est_size)}</span></span>`,
  ].join("")
  const count = row.state === "retired" ? "—" : "0"
  return [
    `<tr data-documented-key="${escapeHtml(row.key)}" class="row-documented state-${row.state}">`,
    sourceCell(row.source, row.host),
    `<td class="col-state">${statePill(row.state)}</td>`,
    `<td class="col-langs"><div class="chips">${row.state === "retired" ? "" : chip}</div></td>`,
    `<td class="col-count">${count}</td>`,
    `<td class="col-missing"><span class="method">${escapeHtml(row.method)}</span> ${escapeHtml(row.note)}</td>`,
    `</tr>`,
  ].join("")
}

const groupRow = (label: string): string =>
  `<tr class="group-row"><td colspan="5">${label}</td></tr>`

/** The whole ledger tbody: grouped source rows, then documented sources. Group
 *  separators render only for non-empty groups. */
function renderLedger(data: CompiledData): string {
  const parts: string[] = []
  const emit = (label: string, rows: string[]): void => {
    if (rows.length > 0) parts.push(groupRow(label), ...rows)
  }
  emit(
    "In production",
    data.source_rows
      .filter((r) => r.group === "production")
      .map(renderSourceRow),
  )
  emit(
    "Blocked",
    data.source_rows.filter((r) => r.group === "blocked").map(renderSourceRow),
  )
  emit(
    "In pipeline — not yet in prod",
    data.source_rows.filter((r) => r.group === "pipeline").map(renderSourceRow),
  )
  emit(
    "Proposed — documented, not started",
    data.documented
      .filter((d) => d.state === "proposed")
      .map(renderDocumentedRow),
  )
  emit(
    "Retired",
    data.documented
      .filter((d) => d.state === "retired")
      .map(renderDocumentedRow),
  )
  return parts.join("\n")
}

function renderSummary(data: CompiledData): string {
  const inProd = data.source_rows.filter((r) => r.group === "production")
  const languagesLive = new Set(
    data.sources.filter((r) => r.embedded_doc_count > 0).map((r) => r.language),
  ).size
  const blocked = data.source_rows.filter((r) => r.group === "blocked").length
  const proposed = data.documented.filter((d) => d.state === "proposed").length
  // Source-row totals already combine detected-language and unclassified
  // documents. Summing that one ledger field keeps the headline directly
  // reconcilable with the table while the secondary table explains the
  // unclassified subset (#86).
  const docs = data.source_rows.reduce((n, row) => n + row.docs_in_prod, 0)
  const stat = (n: number | string, label: string): string =>
    `<div class="stat"><span class="stat-value">${n}</span><span class="stat-label">${label}</span></div>`
  return [
    stat(inProd.length, "sources in prod"),
    stat(languagesLive, "languages live"),
    stat(docs.toLocaleString("en-US"), "embedded documents"),
    stat(blocked, "blocked"),
    stat(proposed, "proposed"),
  ].join("")
}

/** One row of the secondary "unclassified documents" table: a source and its
 *  count of embedded docs with no detected language. Keyed by
 *  `data-unclassified-key` so the merge gate can pin it. */
function renderUnclassifiedRow(u: CompiledUnclassifiedRow): string {
  return [
    `<tr data-unclassified-key="${escapeHtml(u.key)}">`,
    sourceCell(u.source, u.host),
    `<td class="col-count">${u.embedded_doc_count.toLocaleString("en-US")}</td>`,
    `</tr>`,
  ].join("")
}

/** The secondary section (#86). When nothing is unclassified, render nothing —
 *  the table appears only once there are unclassified documents to show. */
function renderUnclassified(data: CompiledData): string {
  const rows = data.unclassified
  if (rows.length === 0) {
    return ""
  }
  const total = rows.reduce((n, u) => n + u.embedded_doc_count, 0)
  const body = rows.map(renderUnclassifiedRow).join("\n")
  return [
    `<h2 class="section-title">Unclassified documents</h2>`,
    `<p class="section-note">Embedded and retrievable, but with no detected language. Included in the index total above and listed here so the gap is visible per source rather than hidden. ${total.toLocaleString("en-US")} document(s) across ${rows.length} source(s).</p>`,
    `<div class="table-scroll">`,
    `<table class="unclassified-table">`,
    `<thead><tr><th class="col-source" scope="col">Source</th><th class="col-count" scope="col">Documents</th></tr></thead>`,
    `<tbody>${body}</tbody>`,
    `</table>`,
    `</div>`,
  ].join("")
}

export function renderHtml(template: string, data: CompiledData): string {
  const provenance = `<span class="dashboard-provenance" hidden data-target="${escapeHtml(data.provenance.target)}" data-source-commit="${escapeHtml(data.provenance.source_commit)}" data-schema-digest="${escapeHtml(data.provenance.schema_digest)}">${escapeHtml(data.provenance.target)} ${escapeHtml(data.provenance.source_commit)} ${escapeHtml(data.provenance.schema_digest)}</span>`
  return template
    .split(DATE_PLACEHOLDER)
    .join(`${escapeHtml(data.provenance.fetched_at)}${provenance}`)
    .split(SUMMARY_PLACEHOLDER)
    .join(renderSummary(data))
    .split(UNCLASSIFIED_PLACEHOLDER)
    .join(renderUnclassified(data))
    .split(ROWS_PLACEHOLDER)
    .join(renderLedger(data))
}
