#!/usr/bin/env tsx
/**
 * Builds the reference corpora the depth agents read (feat-572) from the raw
 * files kept in devo/corpus/raw/ (gitignored, like the other corpora):
 *
 *   easton_ebd2.xml      Easton's Bible Dictionary (1897), CCEL ThML   public domain
 *   smith_bibledict.xml  Smith's Bible Dictionary (1863), CCEL ThML    public domain
 *   tbesg.txt            STEPBible TBESG: Abbott-Smith (1922) lexicon  CC BY 4.0 STEPBible.org
 *   tagnt-mat-jhn.txt    STEPBible TAGNT: Greek Gospels, Strong-tagged CC BY 4.0 STEPBible.org
 *   eng-kjv/46-SIReng-kjv.usfm  Sirach (Ecclesiasticus), KJV 1611, eBible.org  public domain
 *   edersheim-lifetimes.txt  Edersheim, The Life and Times of Jesus the
 *                        Messiah (1883), CCEL plain text           public domain
 *
 * The ThML files are CCEL's own XML, taken from the raw folder of
 * github.com/neuu-org/bible-dictionary-dataset (their parsed JSON is not used).
 * STEPBible: github.com/STEPBible/STEPBible-Data.
 *
 *   pnpm --filter @forge/mastra exec tsx src/scripts/ingest-reference-corpora.ts
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { repoRoot } from "../services/devotional/repo-root"

const CORPUS = path.join(repoRoot(), "devo/corpus")
const RAW = path.join(CORPUS, "raw")

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim()

/** ThML glossary: <term>Head</term> then <def>…</def>, Scripture refs as
 *  <scripRef osisRef="Bible:Luke.15.16">. */
function parseThml(xml: string, source: string) {
  const entries: {
    id: string
    term: string
    source: string
    text: string
    refs: string[]
  }[] = []
  const re = /<term[^>]*>([\s\S]*?)<\/term>\s*<def[^>]*>([\s\S]*?)<\/def>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const term = decode(m[1])
    const body = m[2]
    const refs = [
      ...new Set(
        [...body.matchAll(/osisRef="Bible:([^"]+)"/g)].map((r) => r[1]),
      ),
    ]
    const text = decode(body.replace(/<\/p>/g, "\n\n"))
    if (term && text) {
      entries.push({ id: `${source}:${term}`, term, source, text, refs })
    }
  }
  return entries
}

const STEP_BOOKS: Record<string, string> = {
  Mat: "Matt",
  Mrk: "Mark",
  Luk: "Luke",
  Jhn: "John",
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
const roman = (r: string) =>
  [...r.toLowerCase()].reduce(
    (n, ch, i, all) =>
      ROMAN[ch] < (ROMAN[all[i + 1]] ?? 0) ? n - ROMAN[ch] : n + ROMAN[ch],
    0,
  )
const GOSPEL: Record<string, string> = {
  Matt: "Matt",
  Mark: "Mark",
  Luke: "Luke",
  John: "John",
}

export function parseEdersheim(txt: string) {
  const lines = txt.split("\n")
  const heads: number[] = []
  lines.forEach((l, i) => {
    if (/^CHAPTER [IVXLC]+\.\s*$/.test(l)) heads.push(i)
  })
  let book = 0
  return heads.map((h, k) => {
    const chapter = roman(lines[h].replace(/^CHAPTER |\.\s*$/g, ""))
    if (chapter === 1) book++
    const body = lines.slice(h + 1, heads[k + 1] ?? lines.length)
    const blank = body.findIndex((l) => l.trim() === "")
    const title = body.slice(0, blank).join(" ").replace(/\s+/g, " ").trim()
    const text = body
      .slice(blank + 1)
      .join("\n")
      .replace(/_{10,}/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n /g, "\n")
      .replace(/([^\n])\n(?!\n)/g, "$1 ")
      .trim()
    const refs = [
      ...new Set(
        [
          ...text.matchAll(
            /St\. (Matt|Mark|Luke|John)\.? ([ivxlc]+)\.(?:\s*(\d+)(?:\s*-\s*(\d+))?)?/g,
          ),
        ].map((m) => {
          const c = roman(m[2])
          const b = GOSPEL[m[1]]
          if (!m[3]) return `${b}.${c}`
          return m[4]
            ? `${b}.${c}.${m[3]}-${b}.${c}.${m[4]}`
            : `${b}.${c}.${m[3]}`
        }),
      ),
    ]
    return {
      id: `Edersheim:${book}.${chapter}`,
      term: title,
      source: "Edersheim, The Life and Times of Jesus the Messiah (1883)",
      text,
      refs,
    }
  })
}

async function main() {
  const easton = parseThml(
    await readFile(path.join(RAW, "easton_ebd2.xml"), "utf8"),
    "Easton's Bible Dictionary (1897)",
  )
  const smith = parseThml(
    await readFile(path.join(RAW, "smith_bibledict.xml"), "utf8"),
    "Smith's Bible Dictionary (1863)",
  )

  // TBESG: eStrong \t dStrong= \t uStrong \t Greek \t translit \t morph \t gloss \t definition
  const lexicon: Record<
    string,
    {
      strong: string
      lemma: string
      translit: string
      gloss: string
      text: string
    }
  > = {}
  for (const line of (
    await readFile(path.join(RAW, "tbesg.txt"), "utf8")
  ).split("\n")) {
    const c = line.split("\t")
    if (!/^G\d{4}[A-Z]?$/.test(c[0] ?? "")) continue
    const strong = c[0]
    if (lexicon[strong]) continue
    lexicon[strong] = {
      strong,
      lemma: (c[3] ?? "").trim(),
      translit: (c[4] ?? "").trim(),
      gloss: (c[6] ?? "").trim(),
      text: decode((c[7] ?? "").replace(/<BR ?\/?>/gi, " ")),
    }
  }

  // TAGNT: Luk.15.20#01=NKO \t καὶ (kai) \t And \t G2532=CONJ \t καί=and …
  const words: {
    osis: string
    n: number
    greek: string
    translit: string
    english: string
    strong: string
    lemma: string
    gloss: string
  }[] = []
  for (const line of (
    await readFile(path.join(RAW, "tagnt-mat-jhn.txt"), "utf8")
  ).split("\n")) {
    const m = /^(Mat|Mrk|Luk|Jhn)\.(\d+)\.(\d+)#(\d+)=/.exec(line)
    if (!m) continue
    const c = line.split("\t")
    const gm = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(c[1] ?? "")
    const [strongRaw] = (c[3] ?? "").split("=")
    const [lemma, gloss] = (c[4] ?? "").split("=")
    words.push({
      osis: `${STEP_BOOKS[m[1]]}.${Number(m[2])}.${Number(m[3])}`,
      n: Number(m[4]),
      greek: (gm?.[1] ?? c[1] ?? "").replace(/[¶.,;·]/g, "").trim(),
      translit: gm?.[2] ?? "",
      english: (c[2] ?? "").trim(),
      strong: (strongRaw ?? "").trim(),
      lemma: (lemma ?? "").trim(),
      gloss: (gloss ?? "").trim(),
    })
  }

  // Sirach, KJV (USFM): the ancient Jewish wisdom book the historical notes
  // may quote as a primary source for customs (owner, 2026-09-29).
  const sirach: Record<string, string> = {}
  let chapter = 0
  for (const line of (
    await readFile(path.join(RAW, "eng-kjv/46-SIReng-kjv.usfm"), "utf8")
  ).split("\n")) {
    const c = /^\\c\s+(\d+)/.exec(line)
    if (c) {
      chapter = Number(c[1])
      continue
    }
    const v = /^\\v\s+(\d+)\s+(.*)/.exec(line)
    if (v && chapter) {
      sirach[`Sir.${chapter}.${Number(v[1])}`] = v[2]
        .replace(/\\w\s+([^|\\]*)\|[^\\]*\\w\*/g, "$1")
        .replace(/\\[a-z0-9]+\*?/g, "")
        .replace(/\s+/g, " ")
        .trim()
    }
  }

  // Edersheim, by chapter: Jewish law, custom and the rabbinic texts behind
  // the Gospel stories, each chapter indexed by the Gospel passages it cites
  // ("St. Luke xv. 11-32"), so the context agent finds it like a dictionary
  // entry (owner, 2026-09-29).
  const edersheim = parseEdersheim(
    await readFile(path.join(RAW, "edersheim-lifetimes.txt"), "utf8"),
  )

  const write = (file: string, meta: object, data: unknown) =>
    writeFile(
      path.join(CORPUS, file),
      JSON.stringify({ ...meta, ingestedAt: new Date().toISOString(), data }) +
        "\n",
    )
  await write(
    "easton.json",
    { source: "Easton's Bible Dictionary (1897)", license: "public-domain" },
    easton,
  )
  await write(
    "smith.json",
    { source: "Smith's Bible Dictionary (1863)", license: "public-domain" },
    smith,
  )
  await write(
    "abbott-smith.json",
    {
      source:
        "Abbott-Smith, A Manual Greek Lexicon of the New Testament (1922), via STEPBible TBESG",
      license: "CC BY 4.0 (STEPBible.org, Tyndale House Cambridge)",
    },
    lexicon,
  )
  await write(
    "tagnt-gospels.json",
    {
      source: "STEPBible TAGNT, Greek Gospels tagged with Strong numbers",
      license: "CC BY 4.0 (STEPBible.org, Tyndale House Cambridge)",
    },
    words,
  )
  await write(
    "edersheim.json",
    {
      source:
        "Alfred Edersheim, The Life and Times of Jesus the Messiah (1883), via CCEL",
      license: "public-domain",
    },
    edersheim,
  )
  await write(
    "sirach-kjv.json",
    {
      source:
        "Sirach (Ecclesiasticus), King James Version 1611, via eBible.org",
      license: "public-domain",
    },
    sirach,
  )
  console.log(
    `sirach ${Object.keys(sirach).length} verses, easton ${easton.length}, smith ${smith.length}, lexicon ${Object.keys(lexicon).length}, greek words ${words.length}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
