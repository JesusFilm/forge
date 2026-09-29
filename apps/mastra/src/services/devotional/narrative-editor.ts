import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import type { SourceMark } from "./generate-devotional"

/**
 * Narrative editor — reads the finished reflection as ONE spoken piece and asks
 * whether it holds a line: does each paragraph follow from the one before, is
 * anything there that the piece never uses, is a point made twice, does it spell
 * out a conclusion the listener would reach alone, does it plant an association
 * nobody had. And, per paragraph, whether each factual claim is backed by the
 * source the screen credits it to.
 *
 * Added 2026-09-28 after the vineyard review (owner + an outside review). The
 * other critics never saw this class of problem: depth judges one reflection in
 * isolation, fidelity compares only against the ONE commentary excerpt, and a
 * devotional with a historical note and a language note had paragraphs neither
 * could check. What the review found, and this editor is tuned on:
 *   - a tangent: "Roman taxation had pushed small farmers off their land",
 *     introduced and never used again;
 *   - a jump sideways: the denarius compared to a Roman soldier's pay;
 *   - an over-explained ending: "The landowner is not being soft-hearted. He
 *     obeys the Law first, and then goes far past it." (the story shows it);
 *   - a planted association: "nothing to do with curses or superstition";
 *   - one sentence too many after the Ryle quote, restating it;
 *   - a quotation attributed to Ryle with four of his words dropped.
 *   And from the owner's own read (2026-09-28): a negation the ear has to
 *   untangle, a claim more precise than its source ("it fed a family"), and a
 *   figure the story itself contradicts ("he was never counting").
 *
 * The editor PROPOSES; it never rewrites. Its fixes are cuts or the smallest
 * replacement that works, so the text keeps its own voice — a reviewer that
 * smooths everything turns a devotional into the sterile kind nobody finishes.
 */

export type NarrativeIssueKind =
  | "broken-thread"
  | "tangent"
  | "repetition"
  | "over-explains"
  | "planted-association"
  | "unsupported-claim"
  | "misquote"
  | "hard-to-hear"
  | "contradicts-story"

export type NarrativeIssue = {
  kind: NarrativeIssueKind
  severity: "high" | "medium" | "low"
  /** 0-based paragraph index. */
  paragraph: number
  /** The exact words concerned, copied from the paragraph. */
  quote: string
  fix: "cut" | "replace"
  /** For `replace`: the words to put in place of `quote`. Empty for `cut`. */
  replacement: string
  why: string
}

export type NarrativeReview = {
  /** The piece's line in one sentence, as the editor reads it. */
  throughline: string
  issues: NarrativeIssue[]
  summary: string
  /** true when the LLM call failed after a retry: NOT a pass. */
  skipped?: boolean
}

const KINDS = [
  "broken-thread",
  "tangent",
  "repetition",
  "over-explains",
  "planted-association",
  "unsupported-claim",
  "misquote",
  "hard-to-hear",
  "contradicts-story",
] as const

const Schema = z
  .object({
    throughline: z.string(),
    issues: z.array(
      z.object({
        kind: z.enum(KINDS),
        severity: z.enum(["high", "medium", "low"]),
        paragraph: z.number().int(),
        quote: z.string(),
        fix: z.enum(["cut", "replace"]),
        replacement: z.string(),
        why: z.string(),
      }),
    ),
    summary: z.string(),
  })
  .strict()

const JSON_SCHEMA = {
  name: "narrative_review",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      throughline: { type: "string" },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: [...KINDS] },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            // No minimum: the structured-output backend rejects integer bounds
            // (see devotional-reflection-critic.ts).
            paragraph: { type: "integer" },
            quote: { type: "string" },
            fix: { type: "string", enum: ["cut", "replace"] },
            replacement: { type: "string" },
            why: { type: "string" },
          },
          required: [
            "kind",
            "severity",
            "paragraph",
            "quote",
            "fix",
            "replacement",
            "why",
          ],
        },
      },
      summary: { type: "string" },
    },
    required: ["throughline", "issues", "summary"],
  },
}

export const SYSTEM_PROMPT = [
  "You are the final editor of a short spoken Bible devotional (a narrator reads",
  "it over a film after the viewer has watched a Bible scene). You read the",
  "WHOLE reflection as one piece, in order, the way a listener hears it once.",
  "",
  "First, state the piece's throughline in one sentence. Then go through the",
  "piece SENTENCE BY SENTENCE and ask of each one, in turn, every question",
  "below. Do the whole pass before deciding what to report:",
  "- broken-thread: a paragraph that does not follow from the one before it, or",
  "  a jump the listener cannot follow.",
  "- tangent: a fact, image or topic introduced and never used again by the",
  "  argument (interesting is not enough; it has to carry weight later), or an",
  "  aside that pulls the listener's attention away from the scene (e.g. a",
  "  comparison with something outside the story). Test EVERY sentence that",
  "  gives a cause, a background or a comparison: does anything later in the",
  "  piece depend on it? 'Later' INCLUDES the closing takeaway, the question",
  "  and the prayer: a fact the prayer returns to (a 'good eye' the prayer asks",
  "  for) is load-bearing. So is a scene a later paragraph points back to ('that",
  "  market'). If nothing depends on it, it is a tangent, however true.",
  "- repetition: the same point made twice in different words, close together.",
  "  A point deliberately brought back at the END, after the argument, as its",
  "  conclusion is NOT repetition: leave it.",
  "- over-explains: the text states a conclusion the story or the previous",
  "  sentence already makes plain. Trust the listener to connect the dots.",
  "- planted-association: a denial or aside that puts an idea in the listener's",
  "  head that they did not have. Any 'this has nothing to do with X', 'this is",
  "  not about X', 'X is not what it means' where the text itself gave the",
  "  listener no reason to think of X is this, and the fix is to cut the denial.",
  "- unsupported-claim: a factual claim (history, language, numbers, customs)",
  "  that the EVIDENCE for that paragraph does not support. Scripture cited in",
  "  brackets in the paragraph counts as evidence for what that verse says.",
  "  Paragraphs with no credited source are the devotional's own voice: judge",
  "  their facts against general knowledge and flag only what is doubtful.",
  "  A claim MORE PRECISE than its evidence is unsupported too: the evidence",
  "  says a denarius was the usual day's pay, so 'it fed a family for that",
  "  day' claims an economic fact the source does not give. Soften it to what",
  "  the evidence says.",
  "- hard-to-hear: a sentence the listener has to untangle on a single hearing.",
  "  The piece is heard once and never reread: a negation turned inside out",
  "  ('Notice what the workers hired first are not angry about') or a clause",
  "  that only resolves at its end. Fix it by saying the thing plainly ('Notice",
  "  this: the workers hired first were paid exactly what they agreed to').",
  "- contradicts-story: a figure of speech that the literal story contradicts.",
  "  In a parable about paying wages, 'he was never counting' is poetic but",
  "  odd: the landowner counts out a denarius to each man. Prefer the word the",
  "  passage itself uses ('generous', Matthew 20:15).",
  "- misquote: words presented as an author's own (in quotation marks, or",
  "  introduced as 'X says', 'one sentence from X') that differ from that",
  "  author's evidence. Dropped qualifiers count: they change what was said.",
  "  Paraphrase that is NOT presented as the author's words is fine.",
  "",
  "SEVERITY: high = an unsupported factual claim, a misquote, or a break that",
  "loses the listener; medium = what a careful editor would cut (tangent,",
  "repetition, over-explaining, planted association); low = polish.",
  "An unsupported claim is HIGH only when the evidence lacks the FACT itself or",
  "contradicts it. Synonyms of what the evidence says ('grudging' for",
  "'envious'), and the plain sense of an idiom's own image (an 'evil eye' is a",
  "way of looking), are supported: never flag wording at that grain as high;",
  "if you think a word could be closer to the source, that is low at most.",
  "",
  "FIXES: prefer cutting to rewriting. A replacement must be the smallest",
  "change that works and must keep the author's voice, rhythm and concrete",
  "images; never smooth the text into generic devotional prose. Do NOT propose",
  "changes to the closing takeaway, the question or the prayer unless one of",
  "them is factually wrong. Quote the paragraph's words EXACTLY in `quote` so",
  "the fix can be applied mechanically: `replacement` takes the place of the",
  "quoted words and nothing else, so never repeat in it words that stand",
  "outside the quote. Keep each quote as short as the fix allows. Paragraph",
  "numbers are 0-based, as given.",
  "",
  "WHAT TO LEAVE ALONE: short, plain sentences that land a point with weight",
  "('They were not lazy.', 'Every word they say is true.', 'Not for a week.",
  "For that day.') are the piece's voice and rhythm, not over-explaining and",
  "not repetition: never flag them. Nor a sentence that grants the other side",
  "its due before the turn ('It is an honest question'). Nor a TRANSITION: a",
  "sentence that turns the listener to the next section or introduces what",
  "comes ('Now look at who Jesus was telling this to.', 'One sentence from Ryle",
  "is worth carrying out of this:', 'The payment comes at evening for a reason",
  "too.'). Transitions carry the line; they are never tangents. Flag what an",
  "experienced editor would actually cut, not everything that could go: a good",
  "piece usually needs no more than three to five changes, so report the ones",
  "that matter most and let the rest stand.",
  "If the piece is clean, return no issues; do not invent problems to have",
  "something to say.",
  "Return JSON only.",
].join("\n")

export type NarrativeParagraph = {
  text: string
  /** The credit on screen for this paragraph, carried forward from the last
   *  paragraph that set one. */
  mark?: Pick<SourceMark, "label" | "source">
  /** What the source actually says, to check the paragraph's claims against. */
  evidence?: string
}

/**
 * The paragraphs as the listener meets them, each with the credit and the
 * evidence in force for it. A mark stays in force until the next one: that is
 * how the screen shows it, one credit per section.
 */
export function narrativeParagraphs(
  paragraphs: ReadonlyArray<{ text: string; mark?: SourceMark }>,
): NarrativeParagraph[] {
  let current: SourceMark | undefined
  return paragraphs.map((p) => {
    if (p.mark) current = p.mark
    return {
      text: p.text,
      ...(current
        ? { mark: { label: current.label, source: current.source } }
        : {}),
      ...(current?.evidence ? { evidence: current.evidence } : {}),
    }
  })
}

export type ReviewNarrativeInput = {
  sceneTitle: string
  scripture: { reference: string; text: string }
  paragraphs: NarrativeParagraph[]
  conclusion: string
  question: string
  prayer: string
  /** The message the piece was written to serve (message-first path). */
  message?: { idea: string; tension: string }
  llm: DevotionalLlm
}

const RETRY_DELAY_MS = 2_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function buildNarrativeUserPrompt(input: ReviewNarrativeInput): string {
  const evidence = new Map<string, string>()
  for (const p of input.paragraphs) {
    if (p.mark && p.evidence) evidence.set(p.mark.source, p.evidence)
  }
  return [
    `SCENE: ${input.sceneTitle}`,
    `VERSE ON SCREEN (${input.scripture.reference}): ${input.scripture.text}`,
    ...(input.message
      ? [
          `INTENDED MESSAGE: ${input.message.idea}`,
          `ITS TENSION: ${input.message.tension}`,
          "Judge the line against this message: a paragraph that does not serve it is a tangent. If the message itself is not what the passage says, report that as contradicts-story on paragraph 0.",
        ]
      : []),
    "",
    "REFLECTION, paragraph by paragraph:",
    ...input.paragraphs.map(
      (p, i) =>
        `[${i}]${p.mark ? ` (credited on screen: ${p.mark.label.toUpperCase()} / ${p.mark.source})` : " (no credit: the devotional's own voice)"}\n${p.text}`,
    ),
    "",
    `CLOSING TAKEAWAY: ${input.conclusion}`,
    `QUESTION: ${input.question}`,
    `PRAYER: ${input.prayer}`,
    "",
    evidence.size
      ? "EVIDENCE, per credited source (what the source actually says):"
      : "EVIDENCE: none supplied; judge facts against general knowledge.",
    ...[...evidence].map(([source, text]) => `--- ${source} ---\n${text}`),
  ].join("\n")
}

export async function reviewNarrative(
  input: ReviewNarrativeInput,
): Promise<NarrativeReview> {
  const user = buildNarrativeUserPrompt(input)
  const attempt = () =>
    input.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: JSON_SCHEMA,
      schema: Schema,
      temperature: 0.2,
      maxTokens: 2500,
    })
  // The quotation check runs whatever the model does, and its findings stand
  // even when the model call fails.
  const quoted = [
    ...checkQuotations(input.paragraphs),
    ...checkPlantedDenials(input.paragraphs),
  ]
  const withQuotes = (r: NarrativeReview): NarrativeReview => ({
    ...r,
    issues: [
      ...quoted,
      ...r.issues.filter(
        (i) =>
          // Quotations are the code's call, not the model's: it flagged Ryle's
          // exact words as a misquote (2026-09-28) while the word-for-word
          // check above passed them.
          i.kind !== "misquote" &&
          !quoted.some((q) => q.kind === i.kind && q.paragraph === i.paragraph),
      ),
    ],
  })
  try {
    return withQuotes(await attempt())
  } catch (firstError) {
    if (!(firstError instanceof DevotionalLlmError)) throw firstError
    await sleep(RETRY_DELAY_MS)
    try {
      return withQuotes(await attempt())
    } catch (error) {
      if (error instanceof DevotionalLlmError) {
        return {
          throughline: "",
          issues: quoted,
          summary: `narrative review skipped after retry: ${error.code}`,
          skipped: true,
        }
      }
      throw error
    }
  }
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"‘’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)

/**
 * Words presented as the credited author's own, checked word for word against
 * that author's evidence. Deterministic on purpose: the model missed a
 * quotation with four of Ryle's words dropped ("in the next world"), and a
 * misquote is the one finding that must never depend on a model noticing.
 *
 * A quotation is text in quotation marks, or a paragraph introduced by one
 * ending in a colon ("One sentence from Ryle is worth carrying out of this:").
 * Scripture quotations (the paragraph cites a verse in brackets) and short
 * phrases (under six words) are left alone. A quotation whose words run in the
 * evidence unbroken passes; one that matches most of a passage but not all of
 * it is a misquote; one with no near match at all is not flagged here (it may
 * be a quotation from somewhere else, such as Scripture).
 */
export function checkQuotations(
  paragraphs: ReadonlyArray<NarrativeParagraph>,
): NarrativeIssue[] {
  const issues: NarrativeIssue[] = []
  paragraphs.forEach((p, i) => {
    if (!p.evidence) return
    const ev = words(p.evidence)
    const evText = ` ${ev.join(" ")} `
    const quotes: string[] = []
    for (const m of p.text.matchAll(/[“"]([^”"]{12,})[”"]/g)) quotes.push(m[1])
    if (i > 0 && /:\s*$/.test(paragraphs[i - 1].text)) quotes.push(p.text)
    for (const q of quotes) {
      const qw = words(q)
      if (qw.length < 6) continue
      if (evText.includes(` ${qw.join(" ")} `)) continue
      // Best in-order overlap against any evidence window of similar length.
      let best = 0
      for (let s = 0; s < ev.length; s++) {
        let k = 0
        for (
          let e = s;
          e < Math.min(ev.length, s + qw.length * 2) && k < qw.length;
          e++
        ) {
          if (ev[e] === qw[k]) k++
        }
        best = Math.max(best, k)
      }
      if (best / qw.length >= 0.6) {
        issues.push({
          kind: "misquote",
          severity: "high",
          paragraph: i,
          quote: q,
          fix: "replace",
          replacement: q,
          why:
            `presented as ${p.mark?.source ?? "the source"}'s own words, but it ` +
            `does not match the source word for word; restore the exact wording ` +
            `or present it as a paraphrase`,
        })
      }
    }
  })
  return issues
}

/**
 * Denials that plant the idea they deny ("it had nothing to do with curses or
 * superstition"). The model never flagged this one in five runs, so it is
 * matched here. Deliberately narrow: "is not about X, it is about Y" is how an
 * argument turns, and is left to the model.
 */
export function checkPlantedDenials(
  paragraphs: ReadonlyArray<NarrativeParagraph>,
): NarrativeIssue[] {
  const issues: NarrativeIssue[] = []
  paragraphs.forEach((p, i) => {
    for (const m of p.text.matchAll(
      /,?\s*(?:and\s+)?(?:it\s+|this\s+|that\s+)?(?:has|had|have)\s+nothing\s+to\s+do\s+with\s+[^.;!?]+/gi,
    )) {
      issues.push({
        kind: "planted-association",
        severity: "medium",
        paragraph: i,
        quote: m[0],
        fix: "cut",
        replacement: "",
        why:
          "a denial of something the listener was not thinking of puts it in " +
          "their head; cut it unless the text raised the idea first",
      })
    }
  })
  return issues
}

/**
 * Apply the editor's fixes to the paragraphs, for an operator to review as a
 * diff. Fixes whose `quote` is not found verbatim are returned unapplied.
 */
export function applyNarrativeFixes(
  paragraphs: ReadonlyArray<string>,
  issues: ReadonlyArray<NarrativeIssue>,
): { paragraphs: string[]; unapplied: NarrativeIssue[] } {
  const out = [...paragraphs]
  const unapplied: NarrativeIssue[] = []
  for (const i of issues) {
    const p = out[i.paragraph]
    if (p == null || !i.quote || !p.includes(i.quote)) {
      unapplied.push(i)
      continue
    }
    const to = i.fix === "cut" ? "" : i.replacement
    out[i.paragraph] = p
      .replace(i.quote, to)
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
  }
  return { paragraphs: out, unapplied }
}

export const _internal = { JSON_SCHEMA, Schema }
