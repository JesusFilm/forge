#!/usr/bin/env node
/**
 * Ingest Charles Spurgeon's "Morning and Evening" (public domain) from CCEL's
 * ThML source into a clean JSON corpus the devotional pipeline reads for
 * license-free, trustworthy reflection content.
 *
 * Source: https://ccel.org/ccel/spurgeon/morneve.xml (CCEL ThML). Spurgeon died
 * 1892 — the work is public domain. CCEL's digital text is likewise free.
 *
 * Output: <workspace-root>/inputs/reflections/spurgeon-morning-evening.json —
 * local, create-only migration staging data. It is never read from the
 * repository at devotional-run time and must not be committed as a full
 * generated corpus.
 *
 *   node apps/mastra/src/scripts/ingest-spurgeon-morning-evening.mjs --workspace-root=/tmp/devotional-workspace [--file=/tmp/morneve.xml]
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  fetchCorpusText,
  resolveWorkspaceStagingRoot,
  writeCorpusDocument,
} from "./devotional-corpus-staging.mjs"

const SOURCE_URL = "https://ccel.org/ccel/spurgeon/morneve.xml"

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
  return fetchCorpusText(SOURCE_URL)
}

export function buildSpurgeonMorningEveningCorpus(xml) {
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

  return {
    source: "Charles Spurgeon, Morning and Evening",
    sourceUrl: SOURCE_URL,
    license: "public-domain",
    ingestedFrom: "CCEL ThML",
    count: entries.length,
    entries,
  }
}

async function main() {
  const workspaceRoot = resolveWorkspaceStagingRoot()
  const corpus = buildSpurgeonMorningEveningCorpus(await loadSource())
  const outputPath = await writeCorpusDocument({
    workspaceRoot,
    category: "reflections",
    filename: "spurgeon-morning-evening.json",
    document: corpus,
  })

  const withOsis = corpus.entries.filter((entry) => entry.osisRef).length
  const avgLen = Math.round(
    corpus.entries.reduce((sum, entry) => sum + entry.text.length, 0) /
      (corpus.entries.length || 1),
  )
  console.log(
    `✅ ${corpus.entries.length} entries → ${path.relative(process.cwd(), outputPath)}`,
  )
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
