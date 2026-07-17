#!/usr/bin/env node
/**
 * Ingest Charles Spurgeon's "Morning and Evening" (public domain) from CCEL's
 * ThML source into a clean JSON corpus the devotional pipeline reads for
 * license-free, trustworthy reflection content.
 *
 * Source: https://ccel.org/ccel/spurgeon/morneve.xml (CCEL ThML). Spurgeon died
 * 1892 — the work is public domain. CCEL's digital text is likewise free.
 *
 * Output: devo/corpus/spurgeon-morning-evening.json — 732 entries (366 days ×
 * Morning + Evening), each: { id, month, day, session, reference, osisRef,
 * verse, text, source }. Committed to the repo so it ships wherever the app
 * runs (Railway included) — never fetched at devotional-run time.
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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
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
  return clean(m[2]).replace(/^[“”"']+|[“”"']+$/g, "").trim()
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
  const re = /<div2\b[^>]*\bid="d(\d{2})(\d{2})(am|pm)"[^>]*>([\s\S]*?)<\/div2>/g
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

main().catch((e) => {
  console.error("ingest failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
