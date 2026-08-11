#!/usr/bin/env node
/* global fetch */
/**
 * Ingest the World English Bible (WEB, public domain, modern English) for the
 * Gospels + Acts into a flat verse map, so devotional scripture is the EXACT
 * verse text — not model-recalled. WEB is public domain (free to use).
 *
 * Source: getbible.net v2 (whole-book JSON per book). Output:
 * <workspace-root>/inputs/scripture/web-bible.json — local, create-only
 * migration staging data. It is never read from the repository at
 * devotional-run time and must not be committed as a full generated corpus.
 *
 *   node apps/mastra/src/scripts/ingest-web-bible.mjs --workspace-root=/tmp/devotional-workspace
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  resolveWorkspaceStagingRoot,
  writeCorpusDocument,
} from "./devotional-corpus-staging.mjs"

// getbible book number → osis code. Gospels + Acts (where JESUS-film clips live).
const BOOKS = {
  40: "Matt",
  41: "Mark",
  42: "Luke",
  43: "John",
  44: "Acts",
}

export function buildWebBibleCorpus(bookDocuments) {
  const verses = {}
  const books = []
  for (const { osis, book } of bookDocuments) {
    books.push(osis)
    for (const chapter of book.chapters ?? []) {
      for (const verse of chapter.verses ?? []) {
        verses[`${osis}.${verse.chapter}.${verse.verse}`] = String(verse.text)
          .replace(/\s+/g, " ")
          .trim()
      }
    }
  }

  return {
    translation: "World English Bible",
    abbreviation: "WEB",
    license: "public-domain",
    sourceUrl: "https://api.getbible.net/v2/web",
    books,
    verseCount: Object.keys(verses).length,
    verses,
  }
}

async function main() {
  const workspaceRoot = resolveWorkspaceStagingRoot()
  const bookDocuments = await Promise.all(
    Object.entries(BOOKS).map(async ([nr, osis]) => {
      const response = await fetch(`https://api.getbible.net/v2/web/${nr}.json`)
      if (!response.ok) {
        throw new Error(`getbible ${nr}: HTTP ${response.status}`)
      }
      return { osis, book: await response.json() }
    }),
  )

  for (const { osis, book } of bookDocuments) {
    const verseCount = (book.chapters ?? []).reduce(
      (count, chapter) => count + (chapter.verses?.length ?? 0),
      0,
    )
    console.log(`  ✓ ${osis} (${book.name}): ${verseCount} verses`)
  }

  const corpus = buildWebBibleCorpus(bookDocuments)
  const outputPath = await writeCorpusDocument({
    workspaceRoot,
    category: "scripture",
    filename: "web-bible.json",
    document: corpus,
  })
  console.log(
    `\n✅ ${corpus.verseCount} WEB verses → ${path.relative(process.cwd(), outputPath)}`,
  )
}

if (
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(
      "ingest-web-bible failed:",
      e instanceof Error ? e.message : e,
    )
    process.exitCode = 1
  })
}
