#!/usr/bin/env node
/* global AbortController */
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
  DevotionalCorpusStagingError,
  fetchCorpusJson,
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
    if (typeof osis !== "string" || !Array.isArray(book?.chapters)) {
      throw new DevotionalCorpusStagingError(
        "invalid-upstream-corpus",
        "getbible book document is missing its OSIS code or chapters",
      )
    }
    books.push(osis)
    for (const chapter of book.chapters) {
      if (!Array.isArray(chapter?.verses) || chapter.verses.length === 0) {
        throw new DevotionalCorpusStagingError(
          "invalid-upstream-corpus",
          `getbible ${osis} chapter is missing verses`,
        )
      }
      for (const verse of chapter.verses) {
        if (
          !Number.isInteger(verse?.chapter) ||
          verse.chapter < 1 ||
          !Number.isInteger(verse?.verse) ||
          verse.verse < 1 ||
          typeof verse?.text !== "string" ||
          verse.text.trim() === ""
        ) {
          throw new DevotionalCorpusStagingError(
            "invalid-upstream-corpus",
            `getbible ${osis} contains an invalid verse`,
          )
        }
        const reference = `${osis}.${verse.chapter}.${verse.verse}`
        if (Object.hasOwn(verses, reference)) {
          throw new DevotionalCorpusStagingError(
            "duplicate-scripture-reference",
            `getbible corpus contains duplicate reference ${reference}`,
          )
        }
        verses[reference] = verse.text.replace(/\s+/g, " ").trim()
      }
    }
  }

  if (books.length === 0 || Object.keys(verses).length === 0) {
    throw new DevotionalCorpusStagingError(
      "invalid-upstream-corpus",
      "getbible corpus must contain at least one book and verse",
    )
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
  const controller = new AbortController()
  let bookDocuments
  try {
    bookDocuments = await Promise.all(
      Object.entries(BOOKS).map(async ([nr, osis]) => ({
        osis,
        book: await fetchCorpusJson(
          `https://api.getbible.net/v2/web/${nr}.json`,
          { signal: controller.signal },
        ),
      })),
    )
  } catch (error) {
    controller.abort(error)
    throw error
  }

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
