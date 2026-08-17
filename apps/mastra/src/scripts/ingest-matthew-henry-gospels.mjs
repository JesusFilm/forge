#!/usr/bin/env node
/* global fetch */
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
 * Output: one file per book under
 * apps/mastra/devotional-workspace/inputs/reflections/matthew-henry-<book>.json.
 * Split by book deliberately: a single combined file is ~4.2 MB, larger than
 * anything else committed in this repo and close enough to the Workspace's
 * 8 MB per-text-file inventory limit to be worth avoiding. Every filename keeps
 * "henry" because `addReflection` (`workspace/attempt-data.ts`) routes by the
 * source path, and reconcile concatenates all reflection files anyway.
 *
 * The document shape is exactly ReflectionEntriesSchema
 * (`reflection-corpus.ts`): top-level `{ entries }`, per-entry keys only from
 * { source, reference, osisRef, text, verse, book, chapter }. Both are
 * `.strict()` and the Workspace validates every reflections file on reconcile,
 * so an extra key makes the corpus ineligible. Provenance goes to stdout;
 * licence and source URL are recorded in that folder's README.
 *
 *   node apps/mastra/src/scripts/ingest-matthew-henry-gospels.mjs [--file=/tmp/mhc5.xml]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const SOURCE_URL = "https://ccel.org/ccel/henry/mhc5.xml"
const OUT_DIR = path.join(
  REPO_ROOT,
  "apps/mastra/devotional-workspace/inputs/reflections",
)
const SOURCE_LABEL = "Matthew Henry, Commentary on the Whole Bible"
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
  const r = await fetch(SOURCE_URL)
  if (!r.ok) throw new Error(`fetch ${SOURCE_URL} failed: HTTP ${r.status}`)
  return r.text()
}

async function main() {
  const xml = await loadSource()
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
        book,
        chapter,
        reference: `${book} ${chapter}`,
        osisRef: `${book}.${chapter}`,
        text,
        source: SOURCE_LABEL,
      })
    }
  }

  await mkdir(OUT_DIR, { recursive: true })
  for (const book of BOOKS) {
    if (!TARGET.has(book)) continue
    const bookEntries = entries.filter((e) => e.book === book)
    if (bookEntries.length === 0) continue
    const out = path.join(OUT_DIR, `matthew-henry-${book.toLowerCase()}.json`)
    await writeFile(
      out,
      JSON.stringify({ entries: bookEntries }, null, 2) + "\n",
      "utf8",
    )
    const avg = Math.round(
      bookEntries.reduce((s, e) => s + e.text.length, 0) / bookEntries.length,
    )
    console.log(
      `✅ ${bookEntries.length} chapters → ${path.relative(REPO_ROOT, out)} · avg ${avg} chars`,
    )
  }
  console.log(
    `   provenance: ${SOURCE_LABEL} · public domain · CCEL ThML · ${SOURCE_URL}`,
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
