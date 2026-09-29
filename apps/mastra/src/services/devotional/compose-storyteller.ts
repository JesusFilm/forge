import { writeDevotionalCopy, hookStyleForSequence } from "./devotional-copy"
import type { DevotionalVoiceName } from "./elevenlabs-voiceover"
import type {
  GeneratedDevotional,
  ReflectionParagraph,
  SourceMark,
} from "./generate-devotional"
import { stripDashes } from "./generate-devotional"
import type { DevotionalLlm } from "./llm"
import { narrativeParagraphs, reviewNarrative } from "./narrative-editor"
import { attributionFor } from "./reflection-attribution"
import type { ReflectionEntry } from "./reflection-corpus"
import { pickReflectionHighlights } from "./reflection-highlighter"
import { splitCommentaryPoints } from "./reflection-points"
import { splitReflection } from "./reflection-split"
import { verifyQuote, type ReferenceCorpora } from "./reference-corpus"
import { researchBrief, type ResearchBrief } from "./research-brief"
import {
  scriptProblems,
  writeStory,
  type StoryScript,
} from "./storyteller-writer"

/**
 * The storyteller path (owner, 2026-09-29): researchers find and check the
 * material, one strong writer tells it, and the checks look for what was
 * invented. Code enforces the standing rules; the fact checker (the narrative
 * editor, reading every claim against its source) sends back what the sources
 * do not support; its editorial advice rides along in the same single
 * revision. The owner is the judge of taste.
 */

/** Findings from the fact checker that stop a script: things not true. */
const FACT_KINDS = new Set([
  "unsupported-claim",
  "contradicts-story",
  "misquote",
  "planted-association",
])

export type StorytellerInput = {
  clip: { index: number; id: string; title: string }
  passage: { reference: string; osisRef: string }
  passageText: string
  settingText?: string
  scripture: GeneratedDevotional["scripture"]
  classic: { name: string; credit: string; entries: ReflectionEntry[] }
  contextTerms?: string[]
  contextAncient?: string[]
  corpora: ReferenceCorpora
  sequence: number
  date: string
  voices: { main: DevotionalVoiceName; depth: DevotionalVoiceName }
  llms: {
    research: DevotionalLlm
    audit: DevotionalLlm
    writer: DevotionalLlm
    factCheck: DevotionalLlm
    highlights: DevotionalLlm
    /** The current copywriter, for the owner's blind question/prayer A/B. */
    baseline?: DevotionalLlm
  }
  log?: (m: string) => void
}

export type StorytellerResult = {
  devotional: GeneratedDevotional
  brief: ResearchBrief
  script: StoryScript
  /** What each check said, in order, for the owner's notes. */
  checks: string[]
  /** Fact checker findings still open on the final script. */
  openFacts: string[]
  baseline?: { question: string; prayer: string }
}

/** Credits at the start of every run of a sourced section (a fact woven in
 *  twice is credited both times). */
export function creditedParagraphs(
  script: StoryScript,
  opts: {
    voices: { main: DevotionalVoiceName; depth: DevotionalVoiceName }
    brief: ResearchBrief
    corpora: ReferenceCorpora
    classicCredit: string
  },
): ReflectionParagraph[] {
  const { brief } = opts
  const historyEvidence = brief.history
    .map((f) => {
      const e = opts.corpora.dictionaries.find((d) => d.id === f.entryId)
      const para = e?.text.split(/\n{2,}/).find((p) => verifyQuote(f.quote, p))
      return `${f.source}, "${f.term}": ${para ?? f.quote}`
    })
    .join("\n\n")
  const historySource = [
    ...new Set(
      brief.history.map((f) =>
        f.source.startsWith("Edersheim")
          ? "Alfred Edersheim (1883)"
          : f.source.replace(/\s*\(\d{4}\)$/, ""),
      ),
    ),
  ].join(" · ")
  const mark = (role: string): SourceMark | undefined => {
    if (role === "history" && brief.history.length)
      return {
        label: "Historical context",
        source: historySource,
        portrait: "book",
        evidence: historyEvidence,
      }
    if (role === "language" && brief.language)
      return {
        label: "Original language",
        source: "Abbott-Smith's Greek Lexicon",
        portrait: "scroll",
        evidence: `Abbott-Smith (1922), ${brief.language.lemma} (${brief.language.strong}): ${brief.language.lexiconText}`,
      }
    if (role === "classic")
      return {
        label: "Commentary",
        source: opts.classicCredit,
        portrait: "ryle",
        evidence: brief.classicPoints.join("\n\n"),
      }
    return undefined
  }
  return script.paragraphs.map((p, i) => {
    const m =
      script.paragraphs[i - 1]?.role !== p.role ? mark(p.role) : undefined
    return {
      text: stripDashes(p.text),
      role: p.role,
      voice:
        p.role === "history" || p.role === "language"
          ? opts.voices.depth
          : opts.voices.main,
      ...(m ? { mark: m } : {}),
    }
  })
}

export async function composeStoryteller(
  input: StorytellerInput,
): Promise<StorytellerResult> {
  const log = input.log ?? (() => {})
  const checks: string[] = []
  const note = (m: string) => {
    checks.push(m)
    log(m)
  }
  const points = input.classic.entries.flatMap((e) => {
    const ps = splitCommentaryPoints(e.text)
    return ps.length ? ps.map((p) => p.text) : [e.text]
  })

  const brief = await researchBrief({
    corpora: input.corpora,
    passage: input.passage,
    passageText: input.passageText,
    ...(input.settingText ? { settingText: input.settingText } : {}),
    classic: { name: input.classic.name, points },
    ...(input.contextTerms ? { terms: input.contextTerms } : {}),
    ...(input.contextAncient ? { ancient: input.contextAncient } : {}),
    llm: input.llms.research,
    auditLlm: input.llms.audit,
    log,
  })
  note(`💡 ${brief.message.idea}`)
  note(`   tension: ${brief.message.tension}`)
  note(
    `📚 ${brief.history.length} history fact(s), ${brief.language ? 1 : 0} language fact, ${brief.dropped.length} dropped`,
  )

  const passage = {
    reference: input.passage.reference,
    text: input.passageText,
  }
  const setting = input.settingText ? { settingText: input.settingText } : {}
  let script = await writeStory({
    brief,
    passage,
    ...setting,
    llm: input.llms.writer,
  })

  const codeRound = async (label: string) => {
    const problems = scriptProblems(script, brief)
    if (!problems.length) return
    note(`↻ ${label}: ${problems.map((p) => p.rule).join(", ")}`)
    script = await writeStory({
      brief,
      passage,
      ...setting,
      llm: input.llms.writer,
      revise: {
        script,
        problems: problems.map((p) => `${p.rule}: ${p.sentence}. ${p.why}`),
      },
    })
    const left = scriptProblems(script, brief)
    if (left.length)
      note(
        `   still: ${left.map((p) => `${p.rule} (${p.sentence})`).join("; ")}`,
      )
  }
  await codeRound("standing rules")

  const factCheck = async () => {
    const paragraphs = creditedParagraphs(script, {
      voices: input.voices,
      brief,
      corpora: input.corpora,
      classicCredit: input.classic.credit,
    })
    return reviewNarrative({
      sceneTitle: input.clip.title,
      scripture: {
        reference: input.scripture.reference,
        text: input.scripture.text,
      },
      paragraphs: narrativeParagraphs(paragraphs),
      conclusion: script.takeaway,
      question: script.question,
      prayer: script.prayer,
      message: { idea: brief.message.idea, tension: brief.message.tension },
      llm: input.llms.factCheck,
    })
  }
  const describe = (i: {
    kind: string
    paragraph: number
    quote: string
    fix: string
    replacement: string
    why: string
  }) =>
    `${i.kind} in paragraph ${i.paragraph + 1}: “${i.quote}”. ${i.fix === "cut" ? "Cut it" : `Replace with “${i.replacement}”`} (${i.why})`

  const first = await factCheck()
  const facts = first.issues.filter((i) => FACT_KINDS.has(i.kind))
  const advice = first.issues.filter(
    (i) => !FACT_KINDS.has(i.kind) && i.severity !== "low",
  )
  note(
    `🔎 facts: ${facts.length} finding(s); editor: ${advice.length} suggestion(s). ${first.summary}`,
  )
  for (const i of [...facts, ...advice])
    note(`   [${i.severity}/${i.kind}] ¶${i.paragraph + 1}: “${i.quote}”`)
  if (facts.length || advice.length) {
    script = await writeStory({
      brief,
      passage,
      ...setting,
      llm: input.llms.writer,
      revise: {
        script,
        problems: [
          ...facts.map(
            (i) => `NOT SUPPORTED BY THE SOURCES, must change: ${describe(i)}`,
          ),
          ...advice.map(
            (i) =>
              `Editor's suggestion, take it if it makes the piece better: ${describe(i)}`,
          ),
        ],
      },
    })
    await codeRound("standing rules after the revision")
  }
  const last = await factCheck()
  const openFacts = last.issues
    .filter((i) => FACT_KINDS.has(i.kind))
    .map(describe)
  note(
    openFacts.length
      ? `⛔ facts still open: ${openFacts.join(" | ")}`
      : "✅ fact check passed",
  )

  const paragraphs = creditedParagraphs(script, {
    voices: input.voices,
    brief,
    corpora: input.corpora,
    classicCredit: input.classic.credit,
  })
  const text = paragraphs.map((p) => p.text).join(" ")
  const reflectionHighlights = await pickReflectionHighlights({
    chunks: paragraphs.flatMap((p) => splitReflection(p.text)),
    llm: input.llms.highlights,
  })
  const baseline = input.llms.baseline
    ? await writeDevotionalCopy({
        sceneTitle: input.clip.title,
        reference: input.scripture.reference,
        scriptureText: input.scripture.text,
        reflection: text,
        clipTranscript: input.passageText,
        hookStyle: hookStyleForSequence(input.sequence),
        llm: input.llms.baseline,
      })
    : undefined

  const devotional: GeneratedDevotional = {
    date: input.date,
    clip: input.clip,
    passage: input.passage,
    title: stripDashes(script.title),
    message: brief.message,
    openingLines: script.openingLines.map(stripDashes),
    clipTranscript: input.passageText,
    scripture: input.scripture,
    reflection: {
      text,
      source: input.classic.name,
      attribution: attributionFor(
        input.classic.name,
        "Adapted from a trusted classic",
      ),
      flavor: "commentary",
      sourceExcerpt: brief.classicPoints.join("\n\n"),
      paragraphs,
    },
    voices: {
      hook: input.voices.depth,
      "step-reflect": input.voices.main,
      conclusion: input.voices.main,
      scripture: input.voices.main,
      "step-pray": input.voices.depth,
      questions: input.voices.depth,
    },
    reflectionHighlights,
    conclusion: stripDashes(script.takeaway),
    question: stripDashes(script.question),
    prayer: stripDashes(script.prayer),
    mood: "hope",
    voice: input.voices.main,
    sequence: input.sequence,
  }
  return {
    devotional,
    brief,
    script,
    checks,
    openFacts,
    ...(baseline
      ? {
          baseline: {
            question: stripDashes(baseline.question),
            prayer: stripDashes(baseline.prayer),
          },
        }
      : {}),
  }
}
