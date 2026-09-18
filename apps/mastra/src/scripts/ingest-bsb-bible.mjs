#!/usr/bin/env node
/**
 * Ingest the Berean Standard Bible (BSB) for the Gospels + Acts into the same
 * flat verse map the WEB ingest produces, so devotional scripture is the EXACT
 * verse text in a modern translation. The BSB was dedicated to the public
 * domain (CC0) on 2023-04-30 by its publishers (berean.bible/licensing.htm):
 * no licence, attribution or usage restriction applies.
 *
 * Source: the publisher's plain-text export, one "Book C:V<TAB>text" line per
 * verse. Output: devo/corpus/bsb-bible.json — { verses: { "Luke.8.16": "…" } },
 * keyed in osis form like web-bible.json, read at runtime by bible-text.ts.
 *
 *   node apps/mastra/src/scripts/ingest-bsb-bible.mjs
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const OUT = path.join(REPO_ROOT, "devo/corpus/bsb-bible.json")
const SOURCE_URL = "https://bereanbible.com/bsb.txt"

// Book name as printed in the export → osis code. Gospels + Acts, where the
// JESUS-film clips live.
const BOOKS = {
  Matthew: "Matt",
  Mark: "Mark",
  Luke: "Luke",
  John: "John",
  Acts: "Acts",
}

async function main() {
  const r = await fetch(SOURCE_URL)
  if (!r.ok) throw new Error(`bsb.txt: HTTP ${r.status}`)
  const text = (await r.text()).replace(/^﻿/, "")
  const verses = {}
  const counts = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([1-3]?\s?[A-Za-z ]+?) (\d+):(\d+)\t(.*)$/)
    if (!m) continue
    const osis = BOOKS[m[1]]
    if (!osis) continue
    const body = m[4].replace(/\s+/g, " ").trim()
    if (!body) continue
    verses[`${osis}.${m[2]}.${m[3]}`] = body
    counts[osis] = (counts[osis] ?? 0) + 1
  }
  for (const [osis, n] of Object.entries(counts))
    console.log(`  ✓ ${osis}: ${n} verses`)
  if (!verses["Luke.8.16"])
    throw new Error("parse check failed: Luke 8:16 missing")

  const corpus = {
    translation: "Berean Standard Bible",
    abbreviation: "BSB",
    license: "public-domain (CC0, dedicated 2023-04-30)",
    sourceUrl: SOURCE_URL,
    books: Object.values(BOOKS),
    verseCount: Object.keys(verses).length,
    verses,
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(corpus, null, 2) + "\n", "utf8")
  console.log(
    `\n✅ ${corpus.verseCount} BSB verses → ${path.relative(REPO_ROOT, OUT)}`,
  )
}

main().catch((e) => {
  console.error("ingest-bsb-bible failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
