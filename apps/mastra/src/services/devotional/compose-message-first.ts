import { writeDevotionalCopy, hookStyleForSequence } from "./devotional-copy"
import { decideMessage, type DevotionalMessage } from "./devotional-message"
import {
  researchContext,
  researchLanguage,
  type ContextFact,
  type LanguageNote,
} from "./depth-research"
import type {
  GeneratedDevotional,
  ReflectionParagraph,
  SourceMark,
} from "./generate-devotional"
import { stripDashes } from "./generate-devotional"
import type { DevotionalLlm } from "./llm"
import { writeMessageFirstEnding } from "./message-first-ending"
import {
  reviseMessageFirstReflection,
  writeMessageFirstReflection,
  type WrittenParagraph,
} from "./message-first-writer"
import { attributionFor } from "./reflection-attribution"
import type { ReflectionEntry } from "./reflection-corpus"
import { pickReflectionHighlights } from "./reflection-highlighter"
import { splitCommentaryPoints } from "./reflection-points"
import { splitReflection } from "./reflection-split"
import type { ReferenceCorpora } from "./reference-corpus"
import type { DevotionalVoiceName } from "./elevenlabs-voiceover"

/**
 * The message-first devotional (feat-572): message → depth → reflection →
 * ending → packaging, producing the same cached `GeneratedDevotional` the
 * ordinary gate, narration and render take from there. The current
 * copywriter's question and prayer are produced alongside as the owner's
 * blind A/B baseline.
 */

export type MessageFirstInput = {
  clip: { index: number; id: string; title: string }
  passage: { reference: string; osisRef: string }
  passageText: string
  settingReference?: string
  settingText?: string
  /** The verse shown on the scripture card. */
  scripture: GeneratedDevotional["scripture"]
  classic: {
    name: string
    /** Credit line on screen, e.g. "J. C. Ryle (1816–1900)". */
    credit: string
    entries: ReflectionEntry[]
  }
  /** Extra dictionary headwords worth looking up for this story. */
  contextTerms?: string[]
  /** Ancient texts the context agent may quote ("Sir.19.30"). */
  contextAncient?: string[]
  corpora: ReferenceCorpora
  sequence: number
  date: string
  /** Voices: the reflection's own, and the second one for history + language. */
  voices: { main: DevotionalVoiceName; depth: DevotionalVoiceName }
  llms: {
    message: DevotionalLlm
    depth: DevotionalLlm
    writer: DevotionalLlm
    ending: DevotionalLlm
    copy: DevotionalLlm
    highlights: DevotionalLlm
  }
  /** Replace the decided message (the owner's own, after a script review). */
  messageOverride?: DevotionalMessage
  /** The quality gate. When it blocks, its findings go back to the writer for
   *  up to `maxRevisions` targeted rewrites before the result is returned. */
  review?: (
    d: GeneratedDevotional,
  ) => Promise<{ blocking: string[]; problems: string[] }>
  maxRevisions?: number
  log?: (m: string) => void
}

export type MessageFirstResult = {
  devotional: GeneratedDevotional
  message: DevotionalMessage
  context: { status: string; reason: string; facts: ContextFact[] }
  language: { status: string; reason: string; note?: LanguageNote }
  paragraphs: WrittenParagraph[]
  /** Each gate verdict in order. */
  reviews: { blocking: string[]; problems: string[] }[]
  /** The verdict on the version returned (the best round, not always the last). */
  finalReview?: { blocking: string[]; problems: string[] }
  /** The two question/prayer pairs for the owner's blind comparison. */
  ab: {
    messageFirst: { question: string; prayer: string }
    baseline: { question: string; prayer: string }
  }
}

const MARK_LABEL: Record<"history" | "language" | "classic", string> = {
  history: "Historical context",
  language: "Original language",
  classic: "Commentary",
}

/** Voices and credits from the writer's own roles: history and language on
 *  the second voice; each section credited once, where it starts (Vineyard). */
export function buildParagraphs(
  written: WrittenParagraph[],
  opts: {
    voices: { main: DevotionalVoiceName; depth: DevotionalVoiceName }
    context: ContextFact[]
    language?: LanguageNote
    classic: { credit: string; evidence: string }
    corpora: ReferenceCorpora
  },
): ReflectionParagraph[] {
  const credited = new Set<string>()
  const historySources = [
    ...new Set(opts.context.map((f) => f.source.replace(/\s*\(\d{4}\)$/, ""))),
  ]
  const historyEvidence = [
    ...new Set(
      opts.context.map((f) => {
        const e = opts.corpora.dictionaries.find((d) => d.id === f.entryId)
        return `${f.source}, "${f.term}": ${e?.text ?? f.quote}`
      }),
    ),
  ].join("\n\n")
  const markFor = (role: WrittenParagraph["role"]): SourceMark | undefined => {
    if (role === "reflection" || credited.has(role)) return undefined
    if (role === "history") {
      if (!opts.context.length) return undefined
      credited.add(role)
      return {
        label: MARK_LABEL.history,
        source: historySources.join(" · "),
        portrait: "book",
        evidence: historyEvidence,
      }
    }
    if (role === "language") {
      if (!opts.language) return undefined
      credited.add(role)
      return {
        label: MARK_LABEL.language,
        source: "Abbott-Smith's Greek Lexicon",
        portrait: "scroll",
        evidence: `Abbott-Smith (1922), ${opts.language.lemma} (${opts.language.strong}): ${opts.language.lexiconText}`,
      }
    }
    credited.add(role)
    return {
      label: MARK_LABEL.classic,
      source: opts.classic.credit,
      portrait: "ryle",
      evidence: opts.classic.evidence,
    }
  }
  return written.map((p) => {
    const mark = markFor(p.role)
    return {
      text: stripDashes(p.text),
      role: p.role,
      voice:
        p.role === "history" || p.role === "language"
          ? opts.voices.depth
          : opts.voices.main,
      ...(mark ? { mark } : {}),
    }
  })
}

export async function composeMessageFirst(
  input: MessageFirstInput,
): Promise<MessageFirstResult> {
  const log = input.log ?? (() => {})
  const classicPoints = input.classic.entries.flatMap((e) => {
    const points = splitCommentaryPoints(e.text)
    return points.length ? points.map((p) => p.text) : [e.text]
  })

  const message =
    input.messageOverride ??
    (await decideMessage({
      passageReference: input.passage.reference,
      passageText: input.passageText,
      ...(input.settingText
        ? {
            settingReference: input.settingReference ?? "",
            settingText: input.settingText,
          }
        : {}),
      classicSource: input.classic.name,
      classicPoints,
      llm: input.llms.message,
    }))
  // Only the points the message rests on reach the writer, and fidelity is
  // judged against those alone: handed all of Ryle's points on Luke 15 (2,400
  // words) the writer crammed and retold, and the critic flagged every point
  // left out as a dropped argument.
  const chosen = [...new Set(message.classicPoints ?? [])]
    .filter((n) => n >= 1 && n <= classicPoints.length)
    .slice(0, 2)
  const usedPoints = (
    chosen.length ? chosen : [1, 2].filter((n) => n <= classicPoints.length)
  ).map((n) => classicPoints[n - 1])
  const classicEvidence = usedPoints.join("\n\n")
  log(`💡 message: ${message.idea}`)
  log(
    `   classic points: ${(chosen.length ? chosen : [1, 2]).join(", ")} of ${classicPoints.length}`,
  )
  log(`   tension: ${message.tension}`)

  const [context, language] = await Promise.all([
    researchContext({
      corpora: input.corpora,
      passageOsis: input.passage.osisRef,
      passageReference: input.passage.reference,
      passageText: input.passageText,
      ...(input.settingText ? { settingText: input.settingText } : {}),
      message,
      ...(input.contextTerms ? { terms: input.contextTerms } : {}),
      ...(input.contextAncient ? { ancient: input.contextAncient } : {}),
      llm: input.llms.depth,
      log,
    }),
    researchLanguage({
      corpora: input.corpora,
      passageOsis: input.passage.osisRef,
      passageReference: input.passage.reference,
      passageText: input.passageText,
      message,
      llm: input.llms.depth,
      log,
    }),
  ])
  log(
    `📜 context: ${context.status} (${context.facts.length}) ${context.reason}`,
  )
  log(
    `🔤 language: ${language.status} ${language.note?.translit ?? ""} ${language.reason}`,
  )

  let written = await writeMessageFirstReflection({
    message,
    passageReference: input.passage.reference,
    passageText: input.passageText,
    ...(input.settingText ? { settingText: input.settingText } : {}),
    classicName: input.classic.name,
    classicPoints: usedPoints,
    context: context.facts,
    ...(language.note ? { language: language.note } : {}),
    llm: input.llms.writer,
    log,
  })

  const assemble = async (w: WrittenParagraph[]) => {
    const paragraphs = buildParagraphs(w, {
      voices: input.voices,
      context: context.facts,
      ...(language.note ? { language: language.note } : {}),
      classic: { credit: input.classic.credit, evidence: classicEvidence },
      corpora: input.corpora,
    })
    const text = paragraphs.map((p) => p.text).join(" ")
    const ending = await writeMessageFirstEnding({
      message,
      passageReference: input.passage.reference,
      reflection: paragraphs.map((p) => p.text).join("\n\n"),
      llm: input.llms.ending,
    })
    // The owner's baseline: the current copywriter on the same reflection.
    const baseline = await writeDevotionalCopy({
      sceneTitle: input.clip.title,
      reference: input.scripture.reference,
      scriptureText: input.scripture.text,
      reflection: text,
      clipTranscript: input.passageText,
      hookStyle: hookStyleForSequence(input.sequence),
      llm: input.llms.copy,
    })
    const reflectionHighlights = await pickReflectionHighlights({
      chunks: paragraphs.flatMap((p) => splitReflection(p.text)),
      llm: input.llms.highlights,
    })
    const devotional: GeneratedDevotional = {
      date: input.date,
      clip: input.clip,
      passage: input.passage,
      title: stripDashes(ending.title),
      message,
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
        sourceExcerpt: classicEvidence,
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
      conclusion: stripDashes(ending.takeaway),
      question: stripDashes(ending.question),
      prayer: stripDashes(ending.prayer),
      mood: "hope",
      voice: input.voices.main,
      sequence: input.sequence,
    }
    return {
      devotional,
      baseline: {
        question: stripDashes(baseline.question),
        prayer: stripDashes(baseline.prayer),
      },
    }
  }

  let built = await assemble(written)
  const reviews: { blocking: string[]; problems: string[] }[] = []
  // A rewrite can fix one finding and break something that passed before
  // (a revision once dropped depth from 4/5 to 2/5), so the version kept is
  // the one with the fewest blocking findings, not simply the last.
  let best: {
    built: typeof built
    written: WrittenParagraph[]
    score: number
    verdict: { blocking: string[]; problems: string[] }
  } | null = null
  if (input.review) {
    for (let round = 0; ; round++) {
      const verdict = await input.review(built.devotional)
      reviews.push(verdict)
      const score = verdict.blocking.length * 100 + verdict.problems.length
      if (!best || score < best.score) best = { built, written, score, verdict }
      if (verdict.blocking.length === 0) break
      if (round >= (input.maxRevisions ?? 2) || verdict.problems.length === 0)
        break
      log(
        `\n↻ revision ${round + 1}: ${verdict.problems.length} finding(s) back to the writer`,
      )
      written = await reviseMessageFirstReflection({
        paragraphs: written,
        problems: verdict.problems,
        message,
        passageReference: input.passage.reference,
        passageText: input.passageText,
        classicName: input.classic.name,
        classicPoints: usedPoints,
        llm: input.llms.writer,
      })
      built = await assemble(written)
    }
    if (best && best.built !== built) {
      log(`↩︎ keeping the version from an earlier round (fewer findings)`)
      built = best.built
      written = best.written
    }
  }

  return {
    devotional: built.devotional,
    message,
    context,
    language,
    paragraphs: written,
    reviews,
    ...(best ? { finalReview: best.verdict } : {}),
    ab: {
      messageFirst: {
        question: built.devotional.question,
        prayer: built.devotional.prayer,
      },
      baseline: built.baseline,
    },
  }
}
