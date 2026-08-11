#!/usr/bin/env node
/**
 * Ingest Matthew Henry's Commentary — Gospels volume (public domain) from CCEL,
 * for Mark / Luke / John (Matthew is covered by Ryle). Matthew Henry died 1714.
 *
 * Source: https://ccel.org/ccel/henry/mhc5.xml (CCEL ThML, Matthew–John).
 *
 * Granularity: ONE entry per chapter (commentary flows as paragraphs within a
 * chapter with no sub-verse divs). The pipeline pulls the chapter for a clip's
 * passage and the reflection step excerpts the relevant verses.
 *
 * Output: <workspace-root>/inputs/reflections/matthew-henry-gospels.json —
 * local, create-only migration staging data. It is never read from the
 * repository at devotional-run time and must not be committed as a full
 * generated corpus.
 *
 *   node apps/mastra/src/scripts/ingest-matthew-henry-gospels.mjs --workspace-root=/tmp/devotional-workspace [--file=/tmp/mhc5.xml]
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  fetchCorpusText,
  resolveWorkspaceStagingRoot,
  writeCorpusDocument,
} from "./devotional-corpus-staging.mjs"

const SOURCE_URL = "https://ccel.org/ccel/henry/mhc5.xml"
const BOOKS = ["Matthew", "Mark", "Luke", "John"]
const TARGET = new Set(["Mark", "Luke", "John"]) // Matthew → Ryle

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
function clean(html) {
  return decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
function roman2int(s) {
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN[s[i]]
    const next = ROMAN[s[i + 1]]
    total += next && cur < next ? -cur : cur
  }
  return total
}

/** Byte-range slice of one book's div1 (siblings, so slice to the next div1). */
function bookSlice(xml, book) {
  const start = xml.search(new RegExp(`<div1\\b[^>]*\\btitle="${book}"[^>]*>`))
  if (start < 0) return null
  const after = xml.slice(start + 1)
  const nextRel = after.search(/<div1\b/)
  return nextRel < 0 ? xml.slice(start) : xml.slice(start, start + 1 + nextRel)
}

async function loadSource() {
  const local = process.argv.find((a) => a.startsWith("--file="))
  if (local) return readFile(local.slice("--file=".length), "utf8")
  return fetchCorpusText(SOURCE_URL)
}

export function buildMatthewHenryGospelsCorpus(xml) {
  const entries = []
  for (const book of BOOKS) {
    if (!TARGET.has(book)) continue
    const slice = bookSlice(xml, book)
    if (!slice) {
      console.warn(`  ! book not found: ${book}`)
      continue
    }
    const re =
      /<div2\b[^>]*\btitle="Chapter\s+([IVXLC]+)"[^>]*>([\s\S]*?)<\/div2>/g
    let m
    while ((m = re.exec(slice)) !== null) {
      const chapter = roman2int(m[1])
      const text = [...m[2].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
        .map((x) => clean(x[1]))
        .filter(Boolean)
        .join("\n\n")
      if (!chapter || !text) continue
      entries.push({
        id: `${book}.${chapter}`,
        book,
        chapter,
        reference: `${book} ${chapter}`,
        osisRef: `${book}.${chapter}`,
        text,
        source: "Matthew Henry, Commentary on the Whole Bible",
      })
    }
  }

  return {
    source:
      "Matthew Henry, Commentary on the Whole Bible (Gospels: Mark, Luke, John)",
    sourceUrl: SOURCE_URL,
    license: "public-domain",
    ingestedFrom: "CCEL ThML",
    count: entries.length,
    entries,
  }
}

async function main() {
  const workspaceRoot = resolveWorkspaceStagingRoot()
  const corpus = buildMatthewHenryGospelsCorpus(await loadSource())
  const outputPath = await writeCorpusDocument({
    workspaceRoot,
    category: "reflections",
    filename: "matthew-henry-gospels.json",
    document: corpus,
  })

  const byBook = {}
  for (const entry of corpus.entries) {
    byBook[entry.book] = (byBook[entry.book] || 0) + 1
  }
  const avg = Math.round(
    corpus.entries.reduce((sum, entry) => sum + entry.text.length, 0) /
      (corpus.entries.length || 1),
  )
  console.log(
    `✅ ${corpus.entries.length} chapters → ${path.relative(process.cwd(), outputPath)}`,
  )
  console.log(
    `   ${Object.entries(byBook)
      .map(([b, n]) => `${b}:${n}`)
      .join("  ")} · avg ${avg} chars`,
  )
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
