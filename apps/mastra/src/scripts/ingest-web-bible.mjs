#!/usr/bin/env node
/* global fetch */
/**
 * Ingest the World English Bible (WEB, public domain, modern English) for the
 * Gospels + Acts into a flat verse map, so devotional scripture is the EXACT
 * verse text — not model-recalled. WEB is public domain (free to use).
 *
 * Source: getbible.net v2 (whole-book JSON per book).
 *
 * Output: apps/mastra/devotional-workspace/inputs/scripture/web-bible.json —
 * `{ verses: { "Luke.8.24": "…" } }` keyed in osis form so it matches
 * reflection-corpus routing. That is the WHOLE document: WebBibleSchema
 * (`web-bible.ts`) is `.strict()` on `{ verses }` alone and the Workspace
 * validates every scripture `.json` on reconcile (`workspace/schemas.ts`), so
 * a translation/licence envelope here would make the corpus ineligible.
 * Provenance goes to stdout; licence and source URL are recorded in that
 * folder's README.
 *
 *   node apps/mastra/src/scripts/ingest-web-bible.mjs
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const OUT = path.join(
  REPO_ROOT,
  "apps/mastra/devotional-workspace/inputs/scripture/web-bible.json",
)
const SOURCE_URL = "https://api.getbible.net/v2/web"

// getbible book number → osis code. Gospels + Acts (where JESUS-film clips live).
const BOOKS = {
  40: "Matt",
  41: "Mark",
  42: "Luke",
  43: "John",
  44: "Acts",
}

async function main() {
  const verses = {}
  for (const [nr, osis] of Object.entries(BOOKS)) {
    const r = await fetch(`https://api.getbible.net/v2/web/${nr}.json`)
    if (!r.ok) throw new Error(`getbible ${nr}: HTTP ${r.status}`)
    const book = await r.json()
    let n = 0
    for (const ch of book.chapters ?? []) {
      for (const v of ch.verses ?? []) {
        verses[`${osis}.${v.chapter}.${v.verse}`] = String(v.text)
          .replace(/\s+/g, " ")
          .trim()
        n++
      }
    }
    console.log(`  ✓ ${osis} (${book.name}): ${n} verses`)
  }

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify({ verses }, null, 2) + "\n", "utf8")
  console.log(
    `\n✅ ${Object.keys(verses).length} WEB verses → ${path.relative(REPO_ROOT, OUT)}`,
  )
  console.log(
    `   provenance: World English Bible (WEB) · public domain · ${Object.values(
      BOOKS,
    ).join(", ")} · ${SOURCE_URL}`,
  )
}

main().catch((e) => {
  console.error("ingest-web-bible failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
