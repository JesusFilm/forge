#!/usr/bin/env tsx
/**
 * Writes the AUTHORED devotional for the Workers in the Vineyard (Matthew
 * 20:1-16, LUMO) into the text cache, so the ordinary pipeline renders it:
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/author-vineyard-devotional.ts
 *   … then render-one-devotional.ts --source=lumo-matt-20 --structure=clip-first …
 *
 * The words are the owner's approved script (Social Media/Vineyard/
 * script_vineyard.txt, 2026-09-25), not the generator's: its historical and
 * language notes are things the writer agent does not produce. Paragraph by
 * paragraph it records which voice reads it and which source credit it
 * carries. The verse and Ryle's excerpt are read from the corpora rather than
 * retyped, and the accent phrases are picked by the ordinary highlighter agent.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  cacheDirFor,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import { buildDevotionalAgentLlms } from "../services/devotional/devotional-models"
import type {
  GeneratedDevotional,
  ReflectionParagraph,
} from "../services/devotional/generate-devotional"
import { attributionFor } from "../services/devotional/reflection-attribution"
import { pickReflectionHighlights } from "../services/devotional/reflection-highlighter"
import { splitReflection } from "../services/devotional/reflection-split"
import { repoRoot } from "../services/devotional/repo-root"
import { videoSource } from "../services/devotional/video-sources"

const F = "female-c" as const // voice A: the reflection's own voice
const M = "male-e" as const // voice B: history, language, the close

// Wording and avatars from the owner's Figma frames (2026-09-26). Labels name
// the section only, no "from" (owner, 2026-09-28); "adapted from" stays in the
// video description, where the full citation lives.
// What each source actually says, for the narrative editor to check the
// section's claims against (never drawn). The Bible Odyssey pages sit behind a
// bot check, so their evidence is the dictionary entries' own wording as
// search returns it; Thayer is quoted from the entry; Ryle is the corpus text,
// attached in main() once the corpus is loaded.
const SBL_EVIDENCE =
  "Bible Odyssey (Society of Biblical Literature), as found in its dictionary entries 'denarius', 'wages' and 'labor' (summarised from the entries' own text; the full pages were not retrievable): A denarius was a Roman silver coin. One denarius was the usual pay for one day's work by a laborer, the day's wage of a paid agricultural worker; it appears in Matthew 20, where the workers are hired for a denarius a day. Nero's devaluation later in the first century halved its value. It was common in ancient Israel to hire a laborer for a single day's work, and the Torah requires that wages be paid at the end of the day. The day laborer was one of the recognised kinds of worker, alongside the farmer, the shepherd and the craftsman; biblical laws protect laborers' wages."
const THAYER_EVIDENCE =
  "J. H. Thayer, A Greek-English Lexicon of the New Testament (1889), s.v. ὀφθαλμός: Since the eye is the index of the mind, the following phrases have arisen: ὀφθαλμός σου πονηρός ἐστιν, i.e. thou art envious, Matthew 20:15; ὀφθαλμός πονηρός, envy, Mark 7:22 (עַיִן רַע, an envious man, Proverbs 23:6; Proverbs 28:22). s.v. πονηρός: ὀφθαλμός (which see), Matthew 20:15; Mark 7:22, of a bad nature in an ethical sense. Scripture cited in the paragraph (Berean Literal Bible / Berean Standard Bible): Proverbs 23:6 'Do not eat the bread of one evil of eye' (BSB: 'of a stingy man'); Proverbs 28:22 'A man of an evil eye is panicked for wealth' (BSB: 'A stingy man hastens after wealth'); Proverbs 22:9 'The one good of eye, he will be blessed, for he gives from his bread to the poor' (BSB: 'A generous man will be blessed')."

const HISTORY = {
  label: "Historical context",
  source: "Society of Biblical Literature",
  portrait: "book" as const,
  evidence: SBL_EVIDENCE,
}
const GREEK = {
  label: "Original language",
  // Where the meaning comes from, not the word itself (owner's Figma,
  // 2026-09-28): Thayer (1889), s.v. ὀφθαλμός, "i.e. thou art envious,
  // Matthew 20:15". The Greek is read out in the paragraph.
  source: "Thayer's Greek-English Lexicon",
  portrait: "scroll" as const,
  evidence: THAYER_EVIDENCE,
}
// Life dates, not a publication year: they hold for every volume of Ryle's
// Expository Thoughts (the Matthew volume is 1856, Luke 1858).
const RYLE: {
  label: string
  source: string
  portrait: "ryle"
  evidence?: string
} = {
  label: "Commentary",
  source: "J. C. Ryle (1816–1900)",
  portrait: "ryle" as const,
}

const RYLE_SOURCE = "J.C. Ryle, Expository Thoughts on the Gospels: Matthew"

const PARAGRAPHS: ReflectionParagraph[] = [
  {
    voice: F,
    text: "Notice this: the workers hired first were paid exactly what they had agreed to that morning. Nothing was taken from them.",
  },
  {
    voice: M,
    mark: HISTORY,
    text: "A day laborer in Jesus' time owned no land and was promised no work tomorrow. So he stood in the marketplace at dawn and hoped somebody would point at him.",
  },
  {
    voice: M,
    text: "A denarius was a typical day's wage. It was money a worker depended on for daily needs. Not for a week. For that day.",
  },
  {
    voice: M,
    text: "Now read the eleventh hour again. The day was counted from sunrise, so the eleventh hour is about five in the afternoon, one hour before the work stops. Those men had stood in that market since dawn and nobody had picked them. They were not lazy. Nobody wanted them.",
  },
  {
    voice: M,
    text: "The payment comes at evening for a reason too. The Law required that a hired worker be paid before sundown, because he is poor and his life depends on that coin (Deuteronomy 24:14-15, Leviticus 19:13).",
  },
  {
    voice: M,
    mark: GREEK,
    text: 'The landowner\'s last line is softened in English. Most translations give us "are you envious because I am generous?" The Greek is blunter and stranger: "is your eye evil because I am good?"',
  },
  {
    voice: M,
    text: '"Evil eye" was a Hebrew idiom for a stingy, grudging way of looking at people (Proverbs 23:6, 28:22). Its opposite, the "good eye," meant generosity (Proverbs 22:9). So the question is not about a feeling the man could hide. It is about what his eyes do when somebody else is treated better than they earned.',
  },
  // Ryle's credit opens here: this is where the reflection built on his text
  // begins (owner, 2026-09-26), not two paragraphs later where he is named.
  { voice: F, mark: RYLE, text: "Now look at who Jesus was telling this to." },
  {
    voice: F,
    text: 'Right before the story, Peter had asked him out loud: "We have left everything to follow You. What then will there be for us?" It is an honest question, and Peter had every right to ask it. He really had left everything.',
  },
  {
    voice: F,
    text: "Jesus answers him, promises him more than he asked for, and then adds a line: many who are first will be last, and the last will be first. Then he tells this parable, and it closes on that same line turned around.",
  },
  {
    voice: F,
    text: "So the story is not aimed at obvious villains. It is aimed at people who had given up a great deal and had quietly begun keeping a record of it. Ryle says it without softening: Jesus read what was in Peter and his friends, saw what those hearts needed, and gave it to them at once. He checked their rising pride and taught them humility.",
  },
  {
    voice: F,
    text: "That is the uncomfortable part. The workers are not lazy, and they are not wrong about the facts. They did stand in the heat all day. Every word they say is true. In this story the landowner stands where God stands, and that is where the arithmetic breaks: they are adding up what they are owed, while he is giving out of generosity.",
  },
  { voice: F, text: "One sentence from Ryle is worth carrying out of this:" },
  {
    voice: F,
    text: "Whatever a believer receives in the next world is a matter of grace, and not of debt.",
  },
  {
    voice: F,
    text: "The moment you believe God owes you something, every kindness he shows to someone else begins to look like it was taken from you. Grace puts everyone on the same level. It leaves nobody anything to boast about.",
  },
  {
    voice: F,
    text: 'It only sounds harsh from one position: standing in the line, counting. Ryle quotes Bishop Joseph Hall, writing two centuries before him: "If some have cause to magnify God\'s bounty, none have cause to complain." Nobody was cheated. Somebody was given more than they earned, and that is the whole point.',
  },
]

async function main() {
  const src = videoSource("lumo-matt-20")
  if (!src) throw new Error("video source lumo-matt-20 is not registered")

  const corpus = path.join(repoRoot(), "devo/corpus")
  const bsb = JSON.parse(
    await readFile(path.join(corpus, "bsb-bible.json"), "utf8"),
  ) as { verses: Record<string, string> }
  const verse = (n: number) => {
    const v = bsb.verses[`Matt.20.${n}`]
    if (!v) throw new Error(`BSB Matt.20.${n} missing from the corpus`)
    return v
  }
  // A verse lifted out of a speech keeps the speech's closing quote: BSB 20:15
  // ends "…because I am generous?’" with the opening quote back in 20:13. On a
  // verse card that reads as a stray mark, so an unmatched closing quote goes.
  const standalone = (v: string) => {
    const opens = (v.match(/[‘“]/g) ?? []).length
    const closes = (v.match(/[’”]/g) ?? []).length
    return closes > opens ? v.replace(/[’”]\s*$/, "") : v
  }
  const ryle = JSON.parse(
    await readFile(path.join(corpus, "ryle-matthew.json"), "utf8"),
  ) as { entries: { reference: string; text: string }[] }
  const ryleEntry = ryle.entries.find((e) => e.reference === "Matthew 20:1-16")
  if (!ryleEntry)
    throw new Error("Ryle on Matthew 20:1-16 missing from the corpus")
  RYLE.evidence = ryleEntry.text

  // The quotations the script attributes to Ryle must really be his. Checked
  // against the corpus here so a later edit to the script cannot drift from
  // the source without this failing.
  for (const needle of [
    "a matter of grace, and not of debt",
    "If some have cause to magnify God",
    "checked their rising pride, and taught them humility",
  ]) {
    if (!ryleEntry.text.includes(needle)) {
      throw new Error(`Ryle excerpt does not contain: "${needle}"`)
    }
  }

  const text = PARAGRAPHS.map((p) => p.text).join(" ")
  const chunks = PARAGRAPHS.flatMap((p) => splitReflection(p.text))

  const llms = buildDevotionalAgentLlms()
  const reflectionHighlights = await pickReflectionHighlights({
    chunks,
    llm: llms.highlights,
  })

  const devo: GeneratedDevotional = {
    date: new Date().toISOString().slice(0, 10),
    clip: { index: src.index, id: src.mediaComponentId, title: src.title },
    passage: src.passage,
    title: "That's not fair.",
    clipTranscript: Array.from({ length: 16 }, (_, i) => verse(i + 1)).join(
      " ",
    ),
    scripture: {
      reference: "Matthew 20:15",
      text: standalone(verse(15)),
      translation: "BSB",
      needsCanonicalSource: false,
    },
    reflection: {
      text,
      source: RYLE_SOURCE,
      // Year comes from the shared first-publication table, not by hand: a
      // hand-typed 1858 (the Luke volume's year) once slipped in here.
      attribution: attributionFor(
        RYLE_SOURCE,
        "Adapted from a trusted classic",
      ),
      flavor: "commentary",
      sourceExcerpt: ryleEntry.text,
      paragraphs: PARAGRAPHS,
    },
    voices: {
      // The montage opening is read in the male voice (owner, 2026-09-28).
      hook: M,
      "step-reflect": F,
      conclusion: F,
      scripture: F,
      "step-pray": M,
      questions: M,
    },
    reflectionHighlights,
    conclusion:
      "Grace stops sounding like good news the moment you start keeping score.",
    question:
      "Whose blessing have you been quietly measuring against your own effort?",
    prayer: "Name that person to God, and ask him for a good eye toward them.",
    mood: "hope",
    voice: F,
    sequence: 0,
  }

  const dir = cacheDirFor(src.index, 0)
  await saveCachedDevo(dir, devo)
  const marked = reflectionHighlights.filter(Boolean)
  console.log(`wrote ${path.join(dir, "devo.json")}`)
  console.log(`  ${PARAGRAPHS.length} paragraphs → ${chunks.length} cards`)
  console.log(`  ${marked.length} accent phrase(s):`)
  for (const h of marked) console.log(`    · ${h}`)
}

main().catch((e) => {
  console.error(
    "author-vineyard-devotional failed:",
    e instanceof Error ? e.stack : e,
  )
  process.exit(1)
})
