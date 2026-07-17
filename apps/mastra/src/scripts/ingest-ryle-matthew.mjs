#!/usr/bin/env node
/**
 * Ingest J.C. Ryle's "Expository Thoughts on the Gospels: Matthew" (public
 * domain) from CCEL's ThML source into a clean JSON corpus for the devotional
 * pipeline's reflection content. Ryle died 1900 — public domain.
 *
 * Source: https://ccel.org/ccel/ryle/matthew.xml (CCEL ThML). NOTE: CCEL only
 * hosts Ryle's Matthew volume in this form; Mark/Luke/John are covered by
 * Matthew Henry (see ingest-matthew-henry-gospels.mjs).
 *
 * Output: devo/corpus/ryle-matthew.json — one entry per passage section
 * (e.g. "Matthew 8:23-27"), each: { id, book, chapter, reference, osisRef,
 * text, source }. Committed so it ships wherever the app runs.
 *
 *   node apps/mastra/src/scripts/ingest-ryle-matthew.mjs [--file=/tmp/ryle-matthew.xml]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const SOURCE_URL = "https://ccel.org/ccel/ryle/matthew.xml"
const OUT = path.join(REPO_ROOT, "devo/corpus/ryle-matthew.json")

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
  // Each passage section is a <div2 title="Matthew C:V-V" id="...">…</div2>.
  const re =
    /<div2\b[^>]*\btitle="(Matthew\s+(\d+):[0-9,\s-]+)"[^>]*>([\s\S]*?)<\/div2>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const [, reference, chap, block] = m
    // Section passage ref = the first scripRef in the block (id …-p0.x).
    const osisRef = (block.match(/osisRef="Bible:([^"]+)"/) || [])[1] ?? null
    const text = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map((x) => clean(x[1]))
      .filter(Boolean)
      .join("\n\n")
    if (!text) continue
    entries.push({
      id: osisRef ?? reference.replace(/\s+/g, "_"),
      book: "Matthew",
      chapter: Number(chap),
      reference,
      osisRef,
      text,
      source: "J.C. Ryle, Expository Thoughts on the Gospels: Matthew",
    })
  }

  const corpus = {
    source: "J.C. Ryle, Expository Thoughts on the Gospels: Matthew",
    sourceUrl: SOURCE_URL,
    license: "public-domain",
    ingestedFrom: "CCEL ThML",
    count: entries.length,
    entries,
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(corpus, null, 2) + "\n", "utf8")

  const chapters = new Set(entries.map((e) => e.chapter))
  const avg = Math.round(
    entries.reduce((s, e) => s + e.text.length, 0) / (entries.length || 1),
  )
  console.log(`✅ ${entries.length} sections → ${path.relative(REPO_ROOT, OUT)}`)
  console.log(`   chapters ${Math.min(...chapters)}–${Math.max(...chapters)} (${chapters.size}) · avg ${avg} chars`)
}

main().catch((e) => {
  console.error("ingest failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
