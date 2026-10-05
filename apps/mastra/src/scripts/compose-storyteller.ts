#!/usr/bin/env tsx
/**
 * The storyteller path (owner, 2026-09-29) on a LUMO source or a JESUS-film
 * chapter (`--chapter=32`, from 2026-10-05): researcher →
 * code-checked facts → one strong writer → code rules + fact check with one
 * revision. Writes the cached devotional (so render-one-devotional.ts takes it
 * from there), the owner's script sheet and a notes file. Nothing is
 * overwritten: the previous devo.json and review files are kept.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/compose-storyteller.ts --source=lumo-luke-15
 *     src/scripts/compose-storyteller.ts --chapter=32
 */
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import {
  composeStoryteller,
  type StorytellerResult,
} from "../services/devotional/compose-storyteller"
import {
  cacheDirFor,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import {
  DEVOTIONAL_VOICES,
  type DevotionalVoiceName,
} from "../services/devotional/elevenlabs-voiceover"
import { EN_LOCALE } from "../services/devotional/devotional-locale"
import { modelFor } from "../services/devotional/devotional-models"
import {
  formatDevotionalScript,
  readSubtitles,
} from "../services/devotional/devotional-script-format"
import { JESUS_FILM_CHAPTERS } from "../services/devotional/jesus-film-catalog"
import { passageForChapter } from "../services/devotional/jesus-film-passages"
import {
  DEVOTIONAL_BIBLE,
  getVerseText,
} from "../services/devotional/bible-text"
import { createDevotionalLlm } from "../services/devotional/llm"
import {
  balanceQuotes,
  selectScriptureForPassage,
} from "../services/devotional/passage-scripture"
import { loadReferenceCorpora } from "../services/devotional/reference-corpus"
import { loadReflectionCorpora } from "../services/devotional/reflection-corpus"
import { repoRoot } from "../services/devotional/repo-root"
import {
  arclightMediaInfo,
  parseSubtitles,
} from "../services/devotional/subtitle-align"
import {
  type VideoSource,
  videoSource,
} from "../services/devotional/video-sources"

const arg = (name: string, fallback?: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=") ?? fallback

/** Models (2026-09-29): the writer is the strongest; research and the fact
 *  check a step below; the claim audit and highlights are small jobs. */
const MODELS = {
  writer: "anthropic/claude-fable-5.1",
  research: "anthropic/claude-opus-5.5",
  factCheck: "anthropic/claude-opus-5.5",
  audit: "anthropic/claude-sonnet-5.5",
}

const STORIES: Record<
  string,
  {
    setting?: { reference: string; osis: [string, number, number] }
    terms?: string[]
    ancient?: string[]
    out: string
  }
> = {
  "lumo-luke-15": {
    setting: { reference: "Luke 15:1-3", osis: ["Luke.15", 1, 3] },
    terms: [
      "Inheritance",
      "Heir",
      "Firstborn",
      "Servant",
      "Hired servant",
      "Kiss",
      "Shoe",
      "Robe",
      "Swine",
      "Husk",
    ],
    ancient: ["Sir.33.19-Sir.33.23"],
    out: "Prodigal",
  },
  "lumo-luke-10": {
    // The film runs it straight after the Good Samaritan's "Go and do
    // likewise"; the setting lets the writer use that turn from doing to
    // sitting and listening.
    setting: { reference: "Luke 10:36-37", osis: ["Luke.10", 36, 37] },
    terms: [
      "Martha",
      "Mary, Sister Of Lazarus",
      "Bethany",
      "Hospitality",
      "Guest",
      "Meals",
      "Disciple",
      "Rabbi",
      "Entertain",
    ],
    out: "Martha",
  },
  "jesus-32": {
    // Luke puts the blind man straight after the Twelve fail to understand
    // the third passion prediction ("the meaning was hidden from them"): the
    // disciples who see do not understand; the blind man does.
    setting: { reference: "Luke 18:31-34", osis: ["Luke.18", 31, 34] },
    terms: [
      "Bartimaeus",
      "Jericho",
      "Blind",
      "Blindness",
      "Nazareth",
      "Mercy",
      "Faith",
      "Highway",
      "Cloak",
    ],
    out: "Bartimaeus",
  },
}

/** What the script needs from the clip, whichever film it comes from. */
type StorySource = Pick<
  VideoSource,
  "index" | "mediaComponentId" | "title" | "passage" | "window"
> & {
  filmName: string
  /** The translation the film's own dialogue follows. */
  filmTranslation: string
  subtitles: () => Promise<string[]>
}

/**
 * A JESUS-film chapter as a StorySource: the passage and window from
 * jesus-film-passages.ts, the subtitles from the chapter's own Arclight
 * English track, cut to that window. The JESUS film's English is based on
 * the Good News Translation (the film's end card).
 */
function jesusChapter(index: number): StorySource | undefined {
  const passage = passageForChapter(index)
  const chapter = JESUS_FILM_CHAPTERS[index - 1]
  if (!passage || !chapter) return undefined
  const window = {
    startSec: passage.clipStartSec ?? 0,
    lengthSec: passage.clipLengthSec ?? 60,
  }
  return {
    index,
    mediaComponentId: chapter.id,
    title: chapter.title,
    passage: { reference: passage.reference, osisRef: passage.osisRef },
    window,
    filmName: "JESUS film",
    filmTranslation: "dialogue based on the Good News Translation",
    subtitles: async () => {
      const { subtitleUrl } = await arclightMediaInfo(chapter.id)
      if (!subtitleUrl) return []
      const r = await fetch(subtitleUrl)
      if (!r.ok) throw new Error(`subtitles ${chapter.id}: HTTP ${r.status}`)
      const end = window.startSec + window.lengthSec
      return parseSubtitles(await r.text())
        .filter((c) => c.start >= window.startSec && c.start < end)
        .map((c) => c.text.replace(/\s{2,}/g, " "))
    },
  }
}

function lumoSource(key: string): StorySource | undefined {
  const src = videoSource(key)
  if (!src) return undefined
  return {
    ...src,
    filmName: "LUMO",
    filmTranslation: "NIV",
    subtitles: () => readSubtitles(src),
  }
}

function voiceArg(
  i: number,
  fallback: DevotionalVoiceName,
): DevotionalVoiceName {
  const v = arg("voices")?.split(",")[i]
  if (!v) return fallback
  if (!(v in DEVOTIONAL_VOICES))
    throw new Error(`unknown voice in --voices: ${v}`)
  return v as DevotionalVoiceName
}

async function nextFree(p: string): Promise<string> {
  if (!existsSync(p)) return p
  const ext = path.extname(p)
  for (let v = 2; ; v++) {
    const c = `${p.slice(0, -ext.length)}_v${v}${ext}`
    if (!existsSync(c)) return c
  }
}

async function main() {
  const chapterArg = arg("chapter")
  const key = chapterArg ? `jesus-${chapterArg}` : (arg("source") ?? "")
  const src = chapterArg ? jesusChapter(Number(chapterArg)) : lumoSource(key)
  const story = STORIES[key]
  if (!src || !story)
    throw new Error(
      `--source= or --chapter= must be one of ${Object.keys(STORIES).join(", ")}`,
    )
  const seq = Number(arg("seq", "0"))
  const log = (m: string) => console.log(m)

  const bsb = JSON.parse(
    await readFile(path.join(repoRoot(), "devo/corpus/bsb-bible.json"), "utf8"),
  ) as {
    verses: Record<string, string>
  }
  const range = (ch: string, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => {
      const v = bsb.verses[`${ch}.${from + i}`]
      if (!v) throw new Error(`BSB ${ch}.${from + i} missing`)
      return v
    }).join(" ")
  const pm = src.passage.osisRef.match(/^(\w+)\.(\d+)\.(\d+)-\w+\.\d+\.(\d+)$/)
  if (!pm)
    throw new Error(
      `passage osisRef not a single-chapter range: ${src.passage.osisRef}`,
    )
  const chapterKey = `${pm[1]}.${pm[2]}`
  const [v1, v2] = [Number(pm[3]), Number(pm[4])]
  const passageText = range(chapterKey, v1, v2)
  const settingText = story.setting ? range(...story.setting.osis) : undefined
  const entries = loadReflectionCorpora().ryleLuke.filter((e) => {
    const m = e.osisRef?.match(/^Luke\.(\d+)\.(\d+)-Luke\.(\d+)\.(\d+)$/)
    return (
      !!m &&
      `Luke.${m[1]}` === chapterKey &&
      Number(m[2]) >= v1 &&
      Number(m[4]) <= v2
    )
  })
  if (!entries.length)
    throw new Error(`no Ryle section inside ${src.passage.reference}`)

  // Long outputs (a whole script) take minutes on the big models: the default
  // 45s cut the writer's response off mid-body.
  const llm = (model: string) =>
    createDevotionalLlm({ model, timeoutMs: 300_000 })
  // Blind writer A/B (owner, 2026-09-30): --brief-in reuses one run's brief
  // and verse so every writer gets the same material; --ab-out writes the
  // result there and leaves the devotional cache and the owner's folder alone.
  const abOut = arg("ab-out")
  const pinned = arg("brief-in")
    ? (JSON.parse(await readFile(arg("brief-in")!, "utf8")) as {
        brief: StorytellerResult["brief"]
        scripture: Awaited<ReturnType<typeof selectScriptureForPassage>>
      })
    : undefined
  // `--verse=Psalm 27:4`: close on a verse from ELSEWHERE in the Bible
  // (owner's test from Bartimaeus on, 2026-10-05). The owner picks it from
  // checked candidates; the text is the exact BSB, never the model's.
  const verseRef = arg("verse")
  const elsewhere = verseRef ? getVerseText(verseRef) : undefined
  if (verseRef && !elsewhere) throw new Error(`no BSB text for ${verseRef}`)
  const scripture =
    pinned?.scripture ??
    (elsewhere
      ? {
          reference: verseRef!,
          text: balanceQuotes(elsewhere),
          translation: DEVOTIONAL_BIBLE.abbreviation,
          needsCanonicalSource: false,
        }
      : undefined) ??
    (await selectScriptureForPassage({
      reference: src.passage.reference,
      llm: llm(modelFor("scripture")),
    }))
  log(`verse: ${scripture.reference}: ${scripture.text}`)

  const result = await composeStoryteller({
    clip: { index: src.index, id: src.mediaComponentId, title: src.title },
    passage: src.passage,
    passageText,
    ...(settingText ? { settingText } : {}),
    scripture,
    classic: {
      name: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
      credit: "J. C. Ryle (1816–1900)",
      entries,
    },
    ...(story.terms ? { contextTerms: story.terms } : {}),
    ...(story.ancient ? { contextAncient: story.ancient } : {}),
    corpora: loadReferenceCorpora(),
    sequence: seq,
    date: new Date().toISOString().slice(0, 10),
    verses: Object.fromEntries(
      Array.from({ length: v2 - v1 + 1 }, (_, i) => [
        `${chapterKey}.${v1 + i}`,
        bsb.verses[`${chapterKey}.${v1 + i}`]!,
      ]),
    ),
    // main reads the reflection, the takeaway and the closing verse; depth
    // the opening, the history/language notes, the question and the prayer.
    // Voices alternate per devotional (owner, 2026-10-01): `--voices=male-e,female-d`
    // swaps them.
    voices: {
      main: voiceArg(0, "female-d"),
      depth: voiceArg(1, "male-e"),
    },
    llms: {
      research: llm(MODELS.research),
      audit: llm(MODELS.audit),
      writer: llm(arg("writer") ?? MODELS.writer),
      factCheck: llm(arg("fact-check") ?? MODELS.factCheck),
      highlights: llm(modelFor("highlighter")),
      ...(abOut ? {} : { baseline: llm(modelFor("copywriter")) }),
    },
    ...(pinned ? { brief: pinned.brief } : {}),
    ...(arg("brief-out")
      ? {
          onBrief: (brief: StorytellerResult["brief"]) =>
            writeFile(
              arg("brief-out")!,
              JSON.stringify({ brief, scripture }, null, 2),
            ),
        }
      : {}),
    log,
  })
  if (abOut) {
    await mkdir(abOut, { recursive: true })
    const tag = arg("ab-tag") ?? "run"
    await writeFile(
      path.join(abOut, `${tag}.json`),
      JSON.stringify(
        {
          writer: arg("writer") ?? MODELS.writer,
          devotional: result.devotional,
          checks: result.checks,
          openFacts: result.openFacts,
        },
        null,
        2,
      ),
    )
    log(`A/B run written to ${path.join(abOut, `${tag}.json`)}`)
    if (result.openFacts.length) process.exitCode = 2
    return
  }

  const dir = cacheDirFor(src.index, seq)
  const cached = path.join(dir, "devo.json")
  if (existsSync(cached))
    await copyFile(cached, path.join(dir, `devo.before-${Date.now()}.json`))
  await saveCachedDevo(dir, result.devotional)
  log(`wrote ${cached}`)

  const outDir =
    arg("out") ?? path.join(homedir(), "Desktop/Social Media", story.out)
  await mkdir(path.join(outDir, "work"), { recursive: true })
  const scriptPath = await nextFree(
    path.join(outDir, `script_${story.out.toLowerCase()}.txt`),
  )
  await writeFile(
    scriptPath,
    formatDevotionalScript({
      devo: result.devotional,
      source: src,
      filmName: src.filmName,
      filmTranslation: src.filmTranslation,
      subtitles: await src.subtitles(),
      classicCredit: "J. C. Ryle (Expository Thoughts on Luke, 1858)",
      reflectLeadIn: EN_LOCALE.connectors.steps.reflectAfterClip(),
      prayLeadIn: EN_LOCALE.connectors.steps.pray(),
    }) + "\n",
  )
  const d = result.devotional
  const b = result.brief
  const notes = [
    `# ${src.title}: storyteller run`,
    "",
    `Models: writer ${MODELS.writer}, research ${MODELS.research}, fact check ${MODELS.factCheck}, claim audit ${MODELS.audit}.`,
    "",
    "## Research brief (what the writer was given)",
    `- Message: ${b.message.idea}`,
    `- Tension: ${b.message.tension}`,
    `- Question points toward: ${b.message.askDirection}`,
    `- Grounding: ${b.message.grounding}`,
    `- Insight: ${b.insight ?? "none"}`,
    `- Commentator's points used: ${b.message.classicPoints?.join(", ") || "1"}`,
    ...b.history.map(
      (f) =>
        `- HISTORY (${f.source}, ${f.term}): ${f.claim}\n  Source words: "${f.quote}" (verified)`,
    ),
    ...(b.language
      ? [
          `- LANGUAGE (${b.language.verseRef}, "${b.language.englishPhrase}"): ${b.language.meaning}\n  Lexicon: "${b.language.quote}" (verified)`,
          ...(b.language.more ?? []).map(
            (m) => `  also: ${m.meaning}\n  Lexicon: "${m.quote}" (verified)`,
          ),
        ]
      : []),
    "",
    "## Dropped by the checks",
    ...(b.dropped.length ? b.dropped.map((x) => `- ${x}`) : ["- nothing"]),
    "",
    "## Checks, in order",
    ...result.checks.map((c) => `    ${c}`),
    "",
    "## Question and prayer: the current copywriter, for comparison",
    ...(result.baseline
      ? [
          `- Question: ${result.baseline.question}`,
          `- Prayer: ${result.baseline.prayer}`,
        ]
      : []),
    `(The storyteller's own: "${d.question}" / "${d.prayer}")`,
    ...(result.openFacts.length
      ? ["", "## Facts still open", ...result.openFacts.map((f) => `- ${f}`)]
      : []),
  ].join("\n")
  const notesPath = await nextFree(
    path.join(outDir, "work", "storyteller_notes.md"),
  )
  await writeFile(notesPath, notes + "\n")
  log(`\nscript: ${scriptPath}\nnotes:  ${notesPath}`)
  if (result.openFacts.length) {
    // Saved so the text can be read and fixed, but the run is not a success:
    // the render's gate will refuse it until the facts are settled.
    log(`\n⛔ ${result.openFacts.length} fact(s) still open, see the notes`)
    process.exitCode = 2
  }
}

main().catch((e) => {
  console.error("compose-storyteller failed:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
