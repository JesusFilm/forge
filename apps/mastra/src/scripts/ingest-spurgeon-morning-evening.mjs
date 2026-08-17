#!/usr/bin/env node
/* global fetch */
/**
 * Ingest Charles Spurgeon's "Morning and Evening" (public domain) from CCEL's
 * ThML source into a clean JSON corpus of license-free reflection content.
 *
 * Source: https://ccel.org/ccel/spurgeon/morneve.xml (CCEL ThML). Spurgeon died
 * 1892 — the work is public domain. CCEL's digital text is likewise free.
 *
 * Output: devo/corpus/spurgeon-morning-evening.json — 732 entries (366 days ×
 * Morning + Evening), each: { id, month, day, session, reference, osisRef,
 * verse, text, source }.
 *
 * NOT WORKSPACE-ELIGIBLE AS WRITTEN, and its output path is gitignored, so
 * nothing here reaches a deployed run today. Unlike its Ryle / Matthew Henry /
 * WEB siblings this script was deliberately left on the old shape when the
 * corpus moved into the Workspace seed (`devotional-workspace/inputs/`),
 * because reaching that shape means discarding the calendar keys
 * (`month`/`day`/`session`) that `ReflectionEntriesSchema` has nowhere to put —
 * a design question, not a mechanical port. Two things are required before a
 * Spurgeon file can be added, and BOTH are open:
 *
 *   1. Emit the contract shape: top-level `{ entries }` only, per-entry keys
 *      only from { source, reference, osisRef, text, verse, book, chapter }.
 *      Both schemas are `.strict()` and the Workspace validates reflections on
 *      reconcile, so today's envelope is silently EXCLUDED as invalid-content
 *      (reported, not fatal) and the file simply never becomes eligible.
 *   2. Fix reflection routing first. `addReflection`
 *      (`workspace/attempt-data.ts`) routes by osisRef book prefix before
 *      filename, so 123 of these 732 entries (31 `Matt.*`, 92
 *      `Mark|Luke|John.*`) would land in the Ryle / Matthew Henry commentary
 *      corpora rather than the thematic Spurgeon pool. The Henry side is inert
 *      (it matches whole-chapter osisRefs like `Luke.19`, which no Spurgeon
 *      entry has), but the Ryle side is verse-range matched, so a Spurgeon
 *      devotional can be selected and presented as `flavor: "commentary"`.
 *      Ordering hides it today (`ryle-matthew.json` sorts before any
 *      `spurgeon-*` name, so real Ryle sections win `find()`), which makes it a
 *      filename-ordering accident rather than a guarantee.
 *
 *   node apps/mastra/src/scripts/ingest-spurgeon-morning-evening.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const SOURCE_URL = "https://ccel.org/ccel/spurgeon/morneve.xml"
const OUT = path.join(REPO_ROOT, "devo/corpus/spurgeon-morning-evening.json")

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

export function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_match, entity) =>
    entity.startsWith("#")
      ? String.fromCodePoint(Number(entity.slice(1)))
      : NAMED_ENTITIES[entity],
  )
}

/** Strip ThML/HTML tags, decode entities, collapse whitespace. */
function clean(html) {
  return decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

/** First scripRef's visible reference text (e.g. "Joshua 5:12"). */
function extractReference(block) {
  const m = block.match(/<scripRef\b[^>]*>([^<]+)<\/scripRef>/)
  return m ? clean(m[1]) : null
}
function extractOsis(block) {
  const m = block.match(/osisRef="Bible:([^"]+)"/)
  return m ? m[1] : null
}
/** The quoted verse text from the `passage` element (usually <p>, sometimes
 *  <h3>), sans decorative quotes. */
function extractVerse(block) {
  const m = block.match(/<(p|h3)[^>]*class="passage"[^>]*>([\s\S]*?)<\/\1>/)
  if (!m) return null
  return clean(m[2])
    .replace(/^[“”"']+|[“”"']+$/g, "")
    .trim()
}
/** All `normal` paragraphs = the reflection body. */
function extractText(block) {
  const paras = [...block.matchAll(/<p class="normal"[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
  return paras.join("\n\n")
}

async function loadSource() {
  // Prefer a locally cached copy (for offline re-runs); else fetch from CCEL.
  const local = process.argv.find((a) => a.startsWith("--file="))
  if (local) return readFile(local.slice("--file=".length), "utf8")
  const r = await fetch(SOURCE_URL)
  if (!r.ok) throw new Error(`fetch ${SOURCE_URL} failed: HTTP ${r.status}`)
  return r.text()
}

async function main() {
  const xml = await loadSource()
  const entries = []
  const re =
    /<div2\b[^>]*\bid="d(\d{2})(\d{2})(am|pm)"[^>]*>([\s\S]*?)<\/div2>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const [, mm, dd, ampm, block] = m
    const month = Number(mm)
    const day = Number(dd)
    const session = ampm === "am" ? "morning" : "evening"
    const reference = extractReference(block)
    const verse = extractVerse(block)
    const text = extractText(block)
    if (!reference || !verse || !text) {
      console.warn(`  ! skipping d${mm}${dd}${ampm} (missing field)`)
      continue
    }
    entries.push({
      id: `${mm}${dd}${ampm}`,
      month,
      monthName: MONTHS[month - 1],
      day,
      session,
      reference,
      osisRef: extractOsis(block),
      verse,
      text,
      source: "Charles Spurgeon, Morning and Evening",
    })
  }

  const corpus = {
    source: "Charles Spurgeon, Morning and Evening",
    sourceUrl: SOURCE_URL,
    license: "public-domain",
    ingestedFrom: "CCEL ThML",
    count: entries.length,
    entries,
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(corpus, null, 2) + "\n", "utf8")

  const withOsis = entries.filter((e) => e.osisRef).length
  const avgLen = Math.round(
    entries.reduce((s, e) => s + e.text.length, 0) / (entries.length || 1),
  )
  console.log(`✅ ${entries.length} entries → ${path.relative(REPO_ROOT, OUT)}`)
  console.log(`   ${withOsis} with osisRef · avg reflection ${avgLen} chars`)
}

if (
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error("ingest failed:", e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
