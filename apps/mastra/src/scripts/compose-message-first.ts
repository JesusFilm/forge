#!/usr/bin/env tsx
/**
 * Runs the message-first devotional path (feat-572) on a LUMO source and
 * writes the ordinary cached devotional, so render-one-devotional.ts takes it
 * from there, plus a review sheet for the owner: the message, the verified
 * research notes, the script, and a blind A/B of the question and prayer.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/compose-message-first.ts --source=lumo-luke-15 \
 *     [--seq=0] [--out="~/Desktop/Social Media/Prodigal"]
 *
 * Nothing is overwritten: an existing cached devo.json is kept beside the new
 * one with a timestamp, and review files take the next free version number.
 */
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { composeMessageFirst } from "../services/devotional/compose-message-first"
import { EN_LOCALE } from "../services/devotional/devotional-locale"
import {
  formatDevotionalScript,
  readSubtitles,
} from "../services/devotional/devotional-script-format"
import { writeMessageFirstOpening } from "../services/devotional/message-first-ending"
import {
  cacheDirFor,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import { modelFor } from "../services/devotional/devotional-models"
import { reviewDevotionalText } from "../services/devotional/devotional-quality-gate"
import { createDevotionalLlm } from "../services/devotional/llm"
import { selectScriptureForPassage } from "../services/devotional/passage-scripture"
import { loadReferenceCorpora } from "../services/devotional/reference-corpus"
import { loadReflectionCorpora } from "../services/devotional/reflection-corpus"
import { repoRoot } from "../services/devotional/repo-root"
import { videoSource } from "../services/devotional/video-sources"

const arg = (name: string, fallback?: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=") ?? fallback

/** Per-source story settings the corpora cannot infer. */
const STORIES: Record<
  string,
  {
    setting?: { reference: string; osis: [string, number, number] }
    terms?: string[]
    /** Ancient texts for the context agent (primary sources for customs). */
    ancient?: string[]
    out: string
  }
> = {
  "lumo-luke-15": {
    // Who Jesus is speaking to: the Pharisees' complaint that opens the chapter.
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
    ],
    // Ben Sira on not handing a son the estate while alive: a father gave up
    // his standing and his honor (owner, 2026-09-29). Sirach 19:30 on a man's
    // gait is left out: it does not say running was shameful, so it carried
    // no point of its own.
    ancient: ["Sir.33.19-Sir.33.23"],
    out: "Prodigal",
  },
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
  const key = arg("source")
  const src = key ? videoSource(key) : undefined
  const story = key ? STORIES[key] : undefined
  if (!src || !story)
    throw new Error(
      `--source= must be one of ${Object.keys(STORIES).join(", ")}`,
    )
  const seq = Number(arg("seq", "0"))
  const log = (m: string) => console.log(m)

  const bsb = JSON.parse(
    await readFile(path.join(repoRoot(), "devo/corpus/bsb-bible.json"), "utf8"),
  ) as { verses: Record<string, string> }
  const range = (chapterKey: string, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => {
      const v = bsb.verses[`${chapterKey}.${from + i}`]
      if (!v) throw new Error(`BSB ${chapterKey}.${from + i} missing`)
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
  const settingText = story.setting
    ? range(story.setting.osis[0], story.setting.osis[1], story.setting.osis[2])
    : undefined

  // The classic: every Ryle section inside the passage (Luke 15 has two, the
  // lost son and the elder son).
  const reflections = loadReflectionCorpora()
  const entries = reflections.ryleLuke.filter((e) => {
    const m = e.osisRef?.match(/^Luke\.(\d+)\.(\d+)-Luke\.(\d+)\.(\d+)$/)
    if (!m || `Luke.${m[1]}` !== chapterKey) return false
    return Number(m[2]) >= v1 && Number(m[4]) <= v2
  })
  if (!entries.length)
    throw new Error(`no Ryle section inside ${src.passage.reference}`)
  log(`classic: ${entries.map((e) => e.reference).join(" + ")}`)

  const writerModel = modelFor("modernizer")
  const llm = (model: string) => createDevotionalLlm({ model })
  const scripture = await selectScriptureForPassage({
    reference: src.passage.reference,
    llm: llm(modelFor("scripture")),
  })
  log(`verse: ${scripture.reference}: ${scripture.text}`)

  // Several full runs, message included, and the one the checks like best is
  // kept: one run's quality varies too much to judge the path by (2026-09-29).
  const candidates = Math.max(1, Number(arg("candidates", "1")))
  type Run = Awaited<ReturnType<typeof composeMessageFirst>> & {
    gateLog: string[]
  }
  const runs: Run[] = []
  for (let k = 1; k <= candidates; k++) {
    log(`\n===== candidate ${k}/${candidates} =====`)
    const gateLog: string[] = []
    const result = await composeMessageFirst({
      clip: { index: src.index, id: src.mediaComponentId, title: src.title },
      passage: src.passage,
      passageText,
      ...(story.setting && settingText
        ? { settingReference: story.setting.reference, settingText }
        : {}),
      scripture,
      classic: {
        name: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
        credit: "J. C. Ryle (1816–1900)",
        entries,
      },
      ...(story.terms ? { contextTerms: story.terms } : {}),
      ...(story.ancient ? { contextAncient: story.ancient } : {}),
      review: (devotional) =>
        reviewDevotionalText({
          devotional,
          passageReference: src.passage.reference,
          checkFidelity: true,
          lang: "en",
          log: (m) => {
            gateLog.push(m)
            console.log(m)
          },
        }),
      corpora: loadReferenceCorpora(),
      sequence: seq,
      date: new Date().toISOString().slice(0, 10),
      voices: { main: "female-c", depth: "male-e" },
      llms: {
        message: llm(writerModel),
        depth: llm(writerModel),
        writer: llm(writerModel),
        ending: llm(writerModel),
        copy: llm(modelFor("copywriter")),
        highlights: llm(modelFor("highlighter")),
      },
      log,
    })

    runs.push({ ...result, gateLog })
  }
  const score = (r: Run) =>
    (r.finalReview?.blocking.length ?? 0) * 100 +
    (r.finalReview?.problems.length ?? 0)
  const ranked = [...runs].sort((x, y) => score(x) - score(y))
  const result = ranked[0]
  const gateLog = result.gateLog
  log(
    `\nkept candidate ${runs.indexOf(result) + 1} (score ${score(result)}; others ${ranked.slice(1).map(score).join(", ") || "none"})`,
  )
  const review = result.finalReview ?? { blocking: [], problems: [] }

  // Cache: keep whatever was there.
  const dir = cacheDirFor(src.index, seq)
  const cached = path.join(dir, "devo.json")
  if (existsSync(cached)) {
    const keep = path.join(dir, `devo.before-${Date.now()}.json`)
    await copyFile(cached, keep)
    log(`kept previous ${keep}`)
  }
  await saveCachedDevo(dir, result.devotional)
  log(`wrote ${cached}`)

  // Review files for the owner.
  const outDir =
    arg("out") ?? path.join(homedir(), "Desktop/Social Media", story.out)
  await mkdir(path.join(outDir, "work"), { recursive: true })
  const d = result.devotional
  // The montage opening, from the message's tension (packaging).
  d.openingLines = await writeMessageFirstOpening({
    message: result.message,
    title: d.title,
    passageReference: src.passage.reference,
    llm: llm(writerModel),
  })
  await saveCachedDevo(dir, d)
  const script = formatDevotionalScript({
    devo: d,
    source: src,
    subtitles: await readSubtitles(src),
    classicCredit: "J. C. Ryle (Expository Thoughts on Luke, 1858)",
    reflectLeadIn: EN_LOCALE.connectors.steps.reflectAfterClip(),
    prayLeadIn: EN_LOCALE.connectors.steps.pray(),
  })
  const scriptPath = await nextFree(
    path.join(outDir, `script_${story.out.toLowerCase()}.txt`),
  )
  await writeFile(scriptPath, script + "\n")
  for (const [k, r] of runs.entries()) {
    if (r === result) continue
    const alt = [
      `Candidate ${k + 1} (not kept; score ${score(r)})`,
      `Message: ${r.message.idea}`,
      "",
      ...(r.devotional.reflection.paragraphs ?? []).map((p) => p.text),
      "",
      `TAKEAWAY: ${r.devotional.conclusion}`,
      `QUESTION: ${r.devotional.question}`,
      `PRAYER: ${r.devotional.prayer}`,
      "",
      `Gate: ${r.finalReview?.blocking.join("; ") || "passed"}`,
    ].join("\n")
    await writeFile(
      await nextFree(path.join(outDir, "work", `candidate_${k + 1}.txt`)),
      alt + "\n",
    )
  }

  const flip = Math.random() < 0.5
  const [a, b] = flip
    ? [result.ab.baseline, result.ab.messageFirst]
    : [result.ab.messageFirst, result.ab.baseline]
  const words = (d.reflection.paragraphs ?? []).reduce(
    (n, p) => n + p.text.split(/\s+/).length,
    0,
  )
  const notes = [
    `# ${src.title}: message-first run`,
    "",
    "## Message (decided by the agent, before the script)",
    `- Idea: ${result.message.idea}`,
    `- Tension: ${result.message.tension}`,
    `- Question points toward: ${result.message.askDirection}`,
    `- Grounding: ${result.message.grounding}`,
    "",
    "## Historical context",
    `Status: ${result.context.status}. ${result.context.reason}`,
    ...result.context.facts.map(
      (f) =>
        `- ${f.claim}\n  Source: ${f.source}, "${f.term}": "${f.quote}" (quote verified)\n  Why: ${f.why}`,
    ),
    "",
    "## Original language",
    `Status: ${result.language.status}. ${result.language.reason}`,
    ...(result.language.note
      ? [
          `- ${result.language.note.greek} (${result.language.note.translit}), ${result.language.note.osis}: ${result.language.note.meaning}`,
          `  Source: Abbott-Smith, ${result.language.note.lemma}: "${result.language.note.quote}" (quote verified)`,
          `  Why: ${result.language.note.why}`,
        ]
      : []),
    "",
    `## Script: ${scriptPath}`,
    `${words} words in ${(d.reflection.paragraphs ?? []).length} paragraphs.`,
    "",
    "## Question and prayer: blind A/B",
    "Two writers on the same reflection. Pick the pair you prefer before opening the key.",
    `- A. Question: ${a.question}\n     Prayer: ${a.prayer}`,
    `- B. Question: ${b.question}\n     Prayer: ${b.prayer}`,
    "",
    "## Quality gate",
    `${result.reviews.length} round(s); ${result.reviews.length - 1} revision(s) from the checks' findings.`,
    review.blocking.length
      ? `Still blocking: ${review.blocking.join("; ")}`
      : "Final text passed.",
    "",
    "```",
    ...gateLog,
    "```",
  ].join("\n")
  const notesPath = await nextFree(
    path.join(outDir, "work", "message_first_notes.md"),
  )
  await writeFile(notesPath, notes + "\n")
  const keyPath = await nextFree(path.join(outDir, "work", "ab_key.txt"))
  await writeFile(
    keyPath,
    `A = ${flip ? "current copywriter (baseline)" : "message-first ending"}\nB = ${flip ? "message-first ending" : "current copywriter (baseline)"}\n`,
  )
  log(`\nscript: ${scriptPath}\nnotes:  ${notesPath}\nA/B key: ${keyPath}`)
  if (review.blocking.length) log(`⛔ gate: ${review.blocking.join("; ")}`)
}

main().catch((e) => {
  console.error(
    "compose-message-first failed:",
    e instanceof Error ? e.stack : e,
  )
  process.exit(1)
})
