#!/usr/bin/env node
/* global fetch, Buffer */
/**
 * Ingest J.C. Ryle's "Expository Thoughts on the Gospels: Luke" (public
 * domain, Ryle died 1900) into a clean JSON corpus for the devotional
 * pipeline's reflection content.
 *
 * CCEL only hosts Ryle's MATTHEW volume as structured ThML (see
 * ingest-ryle-matthew.mjs); Luke isn't available there. gracegems.org hosts
 * the full Luke volume as plain legacy HTML, one page per chapter
 * (l01.htm … l24.htm), windows-1252 encoded, each page split into numbered
 * "Section N. Title, Luke C:V-V" blocks (quoted verse in italics, followed
 * by Ryle's commentary paragraphs).
 *
 * The JESUS film (1979) follows Luke exclusively, so this becomes the
 * PRIMARY reflection source for Luke passages (owner preference — Ryle over
 * Matthew Henry, see reflection-corpus.ts matchReflection ordering).
 *
 * Output: apps/mastra/devotional-workspace/inputs/reflections/ryle-luke.json —
 * one entry per section (e.g. "Luke 9:12-17"). The document shape is exactly
 * ReflectionEntriesSchema (`reflection-corpus.ts`): a top-level `{ entries }`
 * and per-entry keys drawn only from { source, reference, osisRef, text, verse,
 * book, chapter }. Both are `.strict()` and the Workspace validates every
 * reflections file on reconcile, so an extra key makes the corpus ineligible.
 * Provenance goes to stdout; licence and source URL live in that folder's
 * README, the one filename reconcile skips.
 *
 *   node apps/mastra/src/scripts/ingest-ryle-luke.mjs [--dir=/tmp/ryle-luke-html]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const BASE_URL = "https://gracegems.org/Ryle/"
const CHAPTERS = 24
const OUT = path.join(
  REPO_ROOT,
  "apps/mastra/devotional-workspace/inputs/reflections/ryle-luke.json",
)
const SOURCE_LABEL = "J.C. Ryle, Expository Thoughts on the Gospels: Luke"

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
}
function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}
/** windows-1252 → UTF-8: only the byte ranges gracegems.org actually uses
 *  (curly quotes, em dash) differ from Latin-1; decode via that codepage. */
function win1252ToUtf8(buf) {
  return Buffer.from(buf)
    .toString("latin1")
    .replace(/[\x80-\x9f]/g, (ch) => {
      const CP1252 = {
        0x91: "‘",
        0x92: "’",
        0x93: "“",
        0x94: "”",
        0x96: "–",
        0x97: "—",
        0x85: "…",
      }
      return CP1252[ch.charCodeAt(0)] ?? ch
    })
}

/** "Luke 9:12-17" / "Luke 9:57" → "Luke.9.12-Luke.9.17" / "Luke.9.57". */
function toOsisRef(reference) {
  const m = reference.match(/Luke\s+(\d+):([\d,\s-]+)/)
  if (!m) return null
  const chapter = m[1]
  const nums = m[2].match(/\d+/g)
  if (!nums?.length) return null
  const first = nums[0]
  const last = nums[nums.length - 1]
  return first === last
    ? `Luke.${chapter}.${first}`
    : `Luke.${chapter}.${first}-Luke.${chapter}.${last}`
}

async function loadChapterHtml(n, localDir) {
  const name = `l${String(n).padStart(2, "0")}.htm`
  if (localDir) return readFile(path.join(localDir, name), "utf8")
  const r = await fetch(`${BASE_URL}${name}`)
  if (!r.ok) throw new Error(`fetch ${name} failed: HTTP ${r.status}`)
  const buf = await r.arrayBuffer()
  return win1252ToUtf8(buf)
}

/**
 * Split one chapter page into its numbered "Section N. Title, Luke C:V-V"
 * entries. "Section N." is always plain text (a reliable anchor for block
 * boundaries), but the title/reference right after it sometimes has inline
 * <font>/<b> tags interposed (chapter 1's "Section 1. </font>Luke's
 * Introduction, Luke 1:1-4" is one such case) — so the title+reference is
 * extracted from a TAG-STRIPPED window, not matched against raw HTML.
 */
function parseChapter(html, chapterNum) {
  const anchorRe = /Section\s+(\d+)\./g
  const anchors = [...html.matchAll(anchorRe)]
  const entries = []
  for (let i = 0; i < anchors.length; i++) {
    const sectionNum = anchors[i][1]
    const afterAnchor = anchors[i].index + anchors[i][0].length
    // Title+reference live within ~400 chars of raw HTML after the anchor.
    const headWindow = stripTags(html.slice(afterAnchor, afterAnchor + 400))
    // Title/reference separator varies: usually "Title, Luke C:V-V" (comma),
    // but some sections have them in separate <p> tags, which collapses to
    // "Title Luke C:V-V" (no comma) once tags are stripped — so the comma is
    // optional, and the title match is non-greedy up to the FIRST "Luke n:n".
    const headMatch = headWindow.match(/^\s*(.+?),?\s*(Luke\s+\d+:[\d,\s-]+)/)
    if (!headMatch) {
      throw new Error(
        `chapter ${chapterNum} section ${sectionNum}: couldn't parse title/reference from "${headWindow.slice(0, 80)}"`,
      )
    }
    const [, title, refRaw] = headMatch
    const reference = refRaw.trim().replace(/\s+/g, " ")
    const blockStart = afterAnchor
    const blockEnd = anchors[i + 1]?.index ?? html.length
    const block = html.slice(blockStart, blockEnd)

    // The Bible quotation is the first NON-EMPTY <i>…</i> right after the
    // header — some pages have a stray empty <i></i> artifact immediately
    // after the reference (e.g. "Luke 9:12-17<i>\n</p>\n</i>"), which a naive
    // first-match would grab instead of the real quote.
    let verse
    let afterVerse = block
    for (const m of block.matchAll(/<i>([\s\S]*?)<\/i>/g)) {
      const stripped = stripTags(m[1])
      if (stripped) {
        verse = stripped
        afterVerse = block.slice(m.index + m[0].length)
        break
      }
    }

    const paragraphs = [...afterVerse.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map((p) => stripTags(p[1]))
      .filter(Boolean)
    const text = paragraphs.join("\n\n")
    if (!text) continue

    const osisRef = toOsisRef(reference)
    entries.push({
      book: "Luke",
      chapter: chapterNum,
      reference: `${title.trim()}, ${reference}`,
      osisRef,
      ...(verse ? { verse } : {}),
      text,
      source: SOURCE_LABEL,
    })
  }
  return entries
}

async function main() {
  const localArg = process.argv.find((a) => a.startsWith("--dir="))
  const localDir = localArg ? localArg.slice("--dir=".length) : null

  const entries = []
  for (let n = 1; n <= CHAPTERS; n++) {
    const html = await loadChapterHtml(n, localDir)
    const chapterEntries = parseChapter(html, n)
    if (chapterEntries.length === 0) {
      throw new Error(`chapter ${n}: parsed 0 sections — check page structure`)
    }
    entries.push(...chapterEntries)
    console.log(`  Luke ${n}: ${chapterEntries.length} sections`)
  }

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify({ entries }, null, 2) + "\n", "utf8")

  const chapters = new Set(entries.map((e) => e.chapter))
  const avg = Math.round(
    entries.reduce((s, e) => s + e.text.length, 0) / (entries.length || 1),
  )
  console.log(
    `✅ ${entries.length} sections → ${path.relative(REPO_ROOT, OUT)}`,
  )
  console.log(
    `   chapters ${Math.min(...chapters)}–${Math.max(...chapters)} (${chapters.size}) · avg ${avg} chars`,
  )
  console.log(
    `   provenance: ${SOURCE_LABEL} · public domain (Ryle d. 1900) · gracegems.org legacy HTML, windows-1252 · ${BASE_URL}`,
  )
}

main().catch((e) => {
  console.error("ingest failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
