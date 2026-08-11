#!/usr/bin/env node
/* global fetch */
/**
 * Ingest J.C. Ryle's "Expository Thoughts on the Gospels: Matthew" (public
 * domain) from CCEL's ThML source into a clean JSON corpus for the devotional
 * pipeline's reflection content. Ryle died 1900 — public domain.
 *
 * Source: https://ccel.org/ccel/ryle/matthew.xml (CCEL ThML). NOTE: CCEL only
 * hosts Ryle's Matthew volume in this form; Mark/Luke/John are covered by
 * Matthew Henry (see ingest-matthew-henry-gospels.mjs).
 *
 * Output: <workspace-root>/inputs/reflections/ryle-matthew.json — local,
 * create-only migration staging data. It is never read from the repository at
 * devotional-run time and must not be committed as a full generated corpus.
 *
 *   node apps/mastra/src/scripts/ingest-ryle-matthew.mjs --workspace-root=/tmp/devotional-workspace [--file=/tmp/ryle-matthew.xml]
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  resolveWorkspaceStagingRoot,
  writeCorpusDocument,
} from "./devotional-corpus-staging.mjs"

const SOURCE_URL = "https://ccel.org/ccel/ryle/matthew.xml"

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

export function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_entity, value) =>
    value.startsWith("#")
      ? String.fromCodePoint(Number(value.slice(1)))
      : NAMED_ENTITIES[value],
  )
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

export function buildRyleMatthewCorpus(xml) {
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

  return {
    source: "J.C. Ryle, Expository Thoughts on the Gospels: Matthew",
    sourceUrl: SOURCE_URL,
    license: "public-domain",
    ingestedFrom: "CCEL ThML",
    count: entries.length,
    entries,
  }
}

async function main() {
  const workspaceRoot = resolveWorkspaceStagingRoot()
  const corpus = buildRyleMatthewCorpus(await loadSource())
  const outputPath = await writeCorpusDocument({
    workspaceRoot,
    category: "reflections",
    filename: "ryle-matthew.json",
    document: corpus,
  })

  const chapters = new Set(corpus.entries.map((entry) => entry.chapter))
  const avg = Math.round(
    corpus.entries.reduce((sum, entry) => sum + entry.text.length, 0) /
      (corpus.entries.length || 1),
  )
  console.log(
    `✅ ${corpus.entries.length} sections → ${path.relative(process.cwd(), outputPath)}`,
  )
  console.log(
    `   chapters ${Math.min(...chapters)}–${Math.max(...chapters)} (${chapters.size}) · avg ${avg} chars`,
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error("ingest failed:", e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
