#!/usr/bin/env node
/**
 * Ingest the Berean Standard Bible (BSB), all 66 books, into the same
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
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const OUT = path.join(REPO_ROOT, "devo/corpus/bsb-bible.json")
const SOURCE_URL = "https://bereanbible.com/bsb.txt"

// Book name as printed in the export → osis code. The whole Bible since
// 2026-10-05: a devotional can close on a verse from elsewhere in Scripture
// (Psalm 27:4 under Martha and Mary), not only the scene's own passage.
const BOOKS = {
  Genesis: "Gen",
  Exodus: "Exod",
  Leviticus: "Lev",
  Numbers: "Num",
  Deuteronomy: "Deut",
  Joshua: "Josh",
  Judges: "Judg",
  Ruth: "Ruth",
  "1 Samuel": "1Sam",
  "2 Samuel": "2Sam",
  "1 Kings": "1Kgs",
  "2 Kings": "2Kgs",
  "1 Chronicles": "1Chr",
  "2 Chronicles": "2Chr",
  Ezra: "Ezra",
  Nehemiah: "Neh",
  Esther: "Esth",
  Job: "Job",
  Psalm: "Ps",
  Proverbs: "Prov",
  Ecclesiastes: "Eccl",
  "Song of Solomon": "Song",
  Isaiah: "Isa",
  Jeremiah: "Jer",
  Lamentations: "Lam",
  Ezekiel: "Ezek",
  Daniel: "Dan",
  Hosea: "Hos",
  Joel: "Joel",
  Amos: "Amos",
  Obadiah: "Obad",
  Jonah: "Jonah",
  Micah: "Mic",
  Nahum: "Nah",
  Habakkuk: "Hab",
  Zephaniah: "Zeph",
  Haggai: "Hag",
  Zechariah: "Zech",
  Malachi: "Mal",
  Matthew: "Matt",
  Mark: "Mark",
  Luke: "Luke",
  John: "John",
  Acts: "Acts",
  Romans: "Rom",
  "1 Corinthians": "1Cor",
  "2 Corinthians": "2Cor",
  Galatians: "Gal",
  Ephesians: "Eph",
  Philippians: "Phil",
  Colossians: "Col",
  "1 Thessalonians": "1Thess",
  "2 Thessalonians": "2Thess",
  "1 Timothy": "1Tim",
  "2 Timothy": "2Tim",
  Titus: "Titus",
  Philemon: "Phlm",
  Hebrews: "Heb",
  James: "Jas",
  "1 Peter": "1Pet",
  "2 Peter": "2Pet",
  "1 John": "1John",
  "2 John": "2John",
  "3 John": "3John",
  Jude: "Jude",
  Revelation: "Rev",
}

async function main() {
  // `--from=<bsb.txt>` reads an already downloaded export instead.
  const from = process.argv.find((a) => a.startsWith("--from="))?.slice(7)
  let raw
  if (from) raw = await readFile(from, "utf8")
  else {
    const r = await fetch(SOURCE_URL)
    if (!r.ok) throw new Error(`bsb.txt: HTTP ${r.status}`)
    raw = await r.text()
  }
  const text = raw.replace(/^\uFEFF/, "")
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
  for (const check of ["Luke.8.16", "Ps.27.4", "Song.2.1", "1John.4.8"])
    if (!verses[check]) throw new Error(`parse check failed: ${check} missing`)

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
