import { parse as parseHtml } from "node-html-parser"
import { escapeHtml } from "./render.js"
import type { CompiledData } from "./types.js"

// ── merge-gate contract ──────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Isolate a keyed `<tr …>…</tr>` without depending on formatter whitespace. */
function extractTr(
  html: string,
  attribute: string,
  value: string,
): string | null {
  const opening = new RegExp(
    `<tr\\b[^>]*\\b${attribute}\\s*=\\s*"${escapeRegExp(value)}"[^>]*>`,
    "i",
  ).exec(html)
  if (opening?.index === undefined) return null
  const start = opening.index
  const end = html.indexOf("</tr>", start)
  return end === -1
    ? html.slice(start)
    : html.slice(start, end + "</tr>".length)
}

function renderedText(html: string): string {
  return parseHtml(html).textContent.replace(/\s+/g, " ").trim()
}

/**
 * Return a list of human-readable misses: every datum from compiled-data.json
 * that does NOT appear in the rendered HTML. An empty array = the gate passes.
 * This is the exact check the CI merge gate (scripts/dashboard-verify.ts) runs
 * against the COMMITTED files, so a hand-edited or stale HTML that drops or
 * alters a row fails the build.
 *
 * Every language cell is matched WITHIN its source's `<tr>` as a chip (keyed by
 * data-language / data-pending-label), not by page-wide string presence —
 * otherwise dropping familylife/es would still pass because familylife/en
 * (same key, same name) and other counts satisfy a global search
 * (CodeRabbit #2, carried over from the per-cell-row era).
 */
export function assertHtmlContainsData(
  html: string,
  data: CompiledData,
): string[] {
  const misses: string[] = []
  if (!html.includes(data.provenance.fetched_at)) {
    misses.push(
      `generated_at "${data.provenance.fetched_at}" missing from HTML`,
    )
  }
  for (const row of data.source_rows) {
    const tr = extractTr(html, "data-key", escapeHtml(row.key))
    if (tr === null) {
      misses.push(`${row.key}: source row <tr data-key> missing from HTML`)
      continue
    }
    const trText = renderedText(tr)
    if (!trText.includes(row.source)) {
      misses.push(
        `${row.key}: source name "${row.source}" missing from its row`,
      )
    }
    const docs = row.docs_in_prod.toLocaleString("en-US")
    if (!trText.includes(docs)) {
      misses.push(`${row.key}: docs-in-prod "${docs}" missing from its row`)
    }
    for (const chip of row.languages) {
      const id = `${row.key}/${chip.language ?? chip.label}`
      const attribute =
        chip.language !== null ? "data-language" : "data-pending-label"
      const attributeValue = chip.language ?? chip.label
      const chipNode = parseHtml(tr)
        .querySelectorAll(`[${attribute}]`)
        .find((node) => node.getAttribute(attribute) === attributeValue)
      if (!chipNode) {
        misses.push(`${id}: chip missing from its source row`)
        continue
      }
      const chipText = renderedText(chipNode.toString())
      if (chip.embedded_doc_count !== null) {
        const count = chip.embedded_doc_count.toLocaleString("en-US")
        if (!chipText.includes(count)) {
          misses.push(`${id}: chip count "${count}" missing from its chip`)
        }
      }
      if (chip.detail !== null && !chipText.includes(chip.detail)) {
        misses.push(`${id}: chip detail "${chip.detail}" missing from its chip`)
      }
    }
  }
  for (const d of data.documented) {
    const tr = extractTr(html, "data-documented-key", escapeHtml(d.key))
    if (tr === null) {
      misses.push(
        `documented/${d.key}: row <tr data-documented-key> missing from HTML`,
      )
      continue
    }
    const trText = renderedText(tr)
    if (!trText.includes(d.source)) {
      misses.push(
        `documented/${d.key}: source name "${d.source}" missing from its row`,
      )
    }
    // method + note render for every documented row; the size/languages chip
    // only for non-retired rows (retired rows carry no chip).
    if (!trText.includes(d.method)) {
      misses.push(
        `documented/${d.key}: method "${d.method}" missing from its row`,
      )
    }
    if (!trText.includes(d.note)) {
      misses.push(`documented/${d.key}: note missing from its row`)
    }
    if (d.state !== "retired") {
      if (!trText.includes(d.languages)) {
        misses.push(
          `documented/${d.key}: languages "${d.languages}" missing from its row`,
        )
      }
      if (!trText.includes(d.est_size)) {
        misses.push(
          `documented/${d.key}: est_size "${d.est_size}" missing from its row`,
        )
      }
    }
  }
  // Unclassified rows (#86) are keyed by data-unclassified-key; hold them to the
  // same source-name + count presence check so a dropped tally is caught too.
  for (const u of data.unclassified) {
    const tr = extractTr(html, "data-unclassified-key", escapeHtml(u.key))
    if (tr === null) {
      misses.push(
        `unclassified/${u.key}: row <tr data-unclassified-key> missing from HTML`,
      )
      continue
    }
    const trText = renderedText(tr)
    if (!trText.includes(u.source)) {
      misses.push(
        `unclassified/${u.key}: source name "${u.source}" missing from its row`,
      )
    }
    const count = u.embedded_doc_count.toLocaleString("en-US")
    if (!trText.includes(count)) {
      misses.push(
        `unclassified/${u.key}: doc count "${count}" missing from its row`,
      )
    }
  }
  return misses
}
