#!/usr/bin/env node
/**
 * Ingest Matthew Henry's Commentary — Gospels volume (public domain) from CCEL,
 * for Mark / Luke / John (Matthew is covered by Ryle). Matthew Henry died 1714.
 *
 * Source: https://ccel.org/ccel/henry/mhc5.xml (CCEL ThML, Matthew–John).
 *
 * Granularity: ONE entry per chapter (commentary flows as paragraphs within a
 * chapter with no sub-verse divs). The pipeline pulls the chapter for a clip's
 * passage and the reflection step excerpts the relevant verses. Output:
 * devo/corpus/matthew-henry-gospels.json — { id, book, chapter, reference,
 * osisRef, text, source }. Committed so it ships wherever the app runs.
 *
 *   node apps/mastra/src/scripts/ingest-matthew-henry-gospels.mjs [--file=/tmp/mhc5.xml]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const SOURCE_URL = "https://ccel.org/ccel/henry/mhc5.xml"
const OUT = path.join(REPO_ROOT, "devo/corpus/matthew-henry-gospels.json")
const BOOKS = ["Matthew", "Mark", "Luke", "John"]
const TARGET = new Set(["Mark", "Luke", "John"]) // Matthew → Ryle

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
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
  const start = xml.search(
    new RegExp(`<div1\\b[^>]*\\btitle="${book}"[^>]*>`),
  )
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

  const corpus = {
    source: "Matthew Henry, Commentary on the Whole Bible (Gospels: Mark, Luke, John)",
    sourceUrl: SOURCE_URL,
    license: "public-domain",
    ingestedFrom: "CCEL ThML",
    count: entries.length,
    entries,
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(corpus, null, 2) + "\n", "utf8")

  const byBook = {}
  for (const e of entries) byBook[e.book] = (byBook[e.book] || 0) + 1
  const avg = Math.round(
    entries.reduce((s, e) => s + e.text.length, 0) / (entries.length || 1),
  )
  console.log(`✅ ${entries.length} chapters → ${path.relative(REPO_ROOT, OUT)}`)
  console.log(`   ${Object.entries(byBook).map(([b, n]) => `${b}:${n}`).join("  ")} · avg ${avg} chars`)
}

main().catch((e) => {
  console.error("ingest failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
