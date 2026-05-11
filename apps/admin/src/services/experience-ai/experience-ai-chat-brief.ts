import { z } from "zod"

export const EDITORIAL_BRIEF_FIELDS = [
  "topicOrPassage",
  "language",
  "audience",
  "desiredOutcome",
  "tone",
  "pageType",
  "scriptureEmphasis",
  "ctaOrNextStep",
] as const

export type EditorialBriefField = (typeof EDITORIAL_BRIEF_FIELDS)[number]

export const EditorialBriefSchema = z.object({
  topicOrPassage: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  audience: z.string().trim().min(1).optional(),
  desiredOutcome: z.string().trim().min(1).optional(),
  tone: z.string().trim().min(1).optional(),
  pageType: z.string().trim().min(1).optional(),
  scriptureEmphasis: z.string().trim().min(1).optional(),
  ctaOrNextStep: z.string().trim().min(1).optional(),
})

export type EditorialBrief = z.infer<typeof EditorialBriefSchema>

export type EditorialBriefAssumptions = Partial<
  Record<EditorialBriefField, string>
>

export const EditorialBriefMetadataSchema = z.object({
  kind: z.literal("editorial_brief"),
  status: z.enum(["collecting", "confirmation_required", "confirmed"]),
  brief: EditorialBriefSchema,
  assumptions: z.record(z.string(), z.string()).optional(),
  missingFields: z.array(z.enum(EDITORIAL_BRIEF_FIELDS)).default([]),
  questionField: z.enum(EDITORIAL_BRIEF_FIELDS).optional(),
  question: z.string().optional(),
})

export type EditorialBriefMetadata = z.infer<
  typeof EditorialBriefMetadataSchema
>

export type BriefTurnResult = {
  metadata: EditorialBriefMetadata
  content: string
  confirmationRequired: boolean
}

const FULL_CREATE_INTENT_RE =
  /\b(create|draft|generate|build|start|make|compose|write|design)\b.*\b(experience|draft|page|canvas|content|journey|reflection|devotional|study|lesson|resource|something)\b|\b(generate|create)\s+(an?\s+)?ai\s+draft\b/i
const DISCOVERY_PROMPT_RE =
  /^\s*(what|which|where|who|why|how)\b|\b(find|search|show|list|suggest)\b.*\b(videos?|candidates?|catalog|library)\b/i
const REBRIEF_PROMPT_RE =
  /\b(re-?brief|start over|from scratch|regenerate from scratch|full regeneration|full regenerate|new brief|redo the brief)\b/i
const CONFIRM_PROMPT_RE =
  /\b(confirm|confirmed|looks good|generate from (this|the) brief|use this brief|go ahead|proceed)\b/i
const UNSURE_RE =
  /\b(not sure|unsure|i don't know|dont know|no idea)\b|ไม่แน่ใจ/i

const BIBLE_REFERENCE_RE =
  /\b(?:genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|1\s*samuel|2\s*samuel|1\s*kings|2\s*kings|1\s*chronicles|2\s*chronicles|ezra|nehemiah|esther|job|psalms?|proverbs?|ecclesiastes|song of songs|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|1\s*corinthians|2\s*corinthians|galatians|ephesians|philippians|colossians|1\s*thessalonians|2\s*thessalonians|1\s*timothy|2\s*timothy|titus|philemon|hebrews|james|1\s*peter|2\s*peter|1\s*john|2\s*john|3\s*john|jude|revelation)\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/i

const FIELD_LABELS: Record<EditorialBriefField, string> = {
  topicOrPassage: "Topic or passage",
  language: "Language",
  audience: "Audience",
  desiredOutcome: "Desired outcome",
  tone: "Tone",
  pageType: "Page type",
  scriptureEmphasis: "Scripture emphasis",
  ctaOrNextStep: "CTA or next step",
}

const DEFAULT_ASSUMPTIONS: Record<EditorialBriefField, string> = {
  topicOrPassage: "Use the editor's original topic as the primary theme.",
  language: "English",
  audience: "General seekers and new believers",
  desiredOutcome: "Help readers meet Jesus and take one faithful next step.",
  tone: "Warm, clear, and invitational",
  pageType: "Jesus Film-style topic Experience page",
  scriptureEmphasis: "Use Scripture references without unsupported claims.",
  ctaOrNextStep:
    "Invite readers to pray and continue with a short Bible study.",
}

function compact(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function cleanCapture(value: string | undefined): string | undefined {
  return compact(
    value?.replace(/\b(for|to|with|and|in)\s*$/i, "").replace(/[.!?]+$/g, ""),
  )
}

export function isFullCreatePrompt(prompt: string): boolean {
  const trimmed = prompt.trim()
  if (!trimmed) return false
  if (DISCOVERY_PROMPT_RE.test(trimmed)) return false
  return FULL_CREATE_INTENT_RE.test(trimmed)
}

export function isDiscoveryPrompt(prompt: string): boolean {
  return DISCOVERY_PROMPT_RE.test(prompt.trim())
}

export function isExplicitRebriefPrompt(prompt: string): boolean {
  return REBRIEF_PROMPT_RE.test(prompt.trim())
}

export function isBriefConfirmationPrompt(prompt: string): boolean {
  return CONFIRM_PROMPT_RE.test(prompt.trim())
}

export function missingBriefFields(brief: EditorialBrief) {
  return EDITORIAL_BRIEF_FIELDS.filter((field) => !compact(brief[field]))
}

export function isCompleteBrief(brief: EditorialBrief) {
  return missingBriefFields(brief).length === 0
}

export function parseBriefMetadata(
  value: unknown,
): EditorialBriefMetadata | null {
  const parsed = EditorialBriefMetadataSchema.safeParse(value)
  if (parsed.success) return parsed.data

  const qualityDraft = z
    .object({
      kind: z.literal("quality_draft"),
      brief: EditorialBriefSchema,
    })
    .passthrough()
    .safeParse(value)
  if (!qualityDraft.success) return null

  return {
    kind: "editorial_brief",
    status: "confirmed",
    brief: qualityDraft.data.brief,
    missingFields: [],
  }
}

export function latestBriefMetadata(
  values: readonly unknown[],
): EditorialBriefMetadata | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const metadata = parseBriefMetadata(values[index])
    if (metadata) return metadata
  }
  return null
}

function extractLanguage(prompt: string): string | undefined {
  if (/\bthai\b|ภาษาไทย|ไทย/i.test(prompt)) return "Thai"
  if (/\benglish\b|อังกฤษ/i.test(prompt)) return "English"
  return undefined
}

function extractTopicOrPassage(prompt: string): string | undefined {
  const passage = prompt.match(BIBLE_REFERENCE_RE)?.[0]
  if (passage) return passage

  const about = prompt.match(/\babout\s+(.+?)(?:\s+for\b|[,.;]|$)/i)?.[1]
  if (about) return cleanCapture(about)

  const on = prompt.match(/\bon\s+(.+?)(?:\s+for\b|[,.;]|$)/i)?.[1]
  return cleanCapture(on)
}

function extractAudience(prompt: string): string | undefined {
  return cleanCapture(
    prompt.match(
      /\bfor\s+(.+?)(?:\s+(?:with|using|in|that|who)\b|[,.;]|$)/i,
    )?.[1],
  )
}

function extractPageType(prompt: string): string | undefined {
  if (/\bexperience\b/i.test(prompt)) return "Experience page"
  if (/\b(content hub|hub)\b/i.test(prompt)) return "Content hub"
  if (/\bpage\b/i.test(prompt)) return "Topic page"
  if (/\bbible study\b/i.test(prompt)) return "Bible study page"
  return undefined
}

function extractTone(prompt: string): string | undefined {
  const tone = prompt.match(
    /\b(?:tone|voice|style)\s*(?:is|:|=)?\s*([^,.]+?)(?:[,.;]|$)/i,
  )?.[1]
  if (tone) return cleanCapture(tone)

  const known = prompt.match(
    /\b(warm|gentle|hopeful|encouraging|pastoral|plain-spoken|conversational|inviting|invitational)\b/i,
  )?.[1]
  return known
    ? known[0].toUpperCase() + known.slice(1).toLowerCase()
    : undefined
}

function extractDesiredOutcome(prompt: string): string | undefined {
  const explicit = prompt.match(
    /\b(?:so that|to help|help|encourage|invite|teach)\s+(.+?)(?:[,.;]|$)/i,
  )?.[0]
  return cleanCapture(explicit)
}

function extractCta(prompt: string): string | undefined {
  const explicit = prompt.match(
    /\b(?:cta|next step|call to action)\s*(?:is|:|=)?\s*([^,.]+?)(?:[,.;]|$)/i,
  )?.[1]
  if (explicit) return cleanCapture(explicit)
  const invite = prompt.match(/\binvite\s+(.+?)(?:[,.;]|$)/i)?.[0]
  return cleanCapture(invite)
}

function extractScriptureEmphasis(
  prompt: string,
  topicOrPassage: string | undefined,
): string | undefined {
  if (topicOrPassage && BIBLE_REFERENCE_RE.test(topicOrPassage)) {
    return `Center the page on ${topicOrPassage}.`
  }
  const scripture = prompt.match(
    /\b(?:scripture emphasis|scripture focus|bible focus)\s*(?:is|:|=)?\s*([^,.]+?)(?:[,.;]|$)/i,
  )?.[1]
  return cleanCapture(scripture)
}

export function extractBriefAnswers(prompt: string): EditorialBrief {
  const topicOrPassage = extractTopicOrPassage(prompt)
  return {
    topicOrPassage,
    language: extractLanguage(prompt),
    audience: extractAudience(prompt),
    desiredOutcome: extractDesiredOutcome(prompt),
    tone: extractTone(prompt),
    pageType: extractPageType(prompt),
    scriptureEmphasis: extractScriptureEmphasis(prompt, topicOrPassage),
    ctaOrNextStep: extractCta(prompt),
  }
}

function mergeBrief(
  current: EditorialBrief,
  next: EditorialBrief,
): EditorialBrief {
  const merged: EditorialBrief = { ...current }
  for (const field of EDITORIAL_BRIEF_FIELDS) {
    const value = compact(next[field])
    if (value) merged[field] = value
  }
  return merged
}

function answerPendingQuestion(
  metadata: EditorialBriefMetadata | null,
  prompt: string,
): {
  brief: EditorialBrief
  assumptions: EditorialBriefAssumptions
} {
  const brief: EditorialBrief = { ...(metadata?.brief ?? {}) }
  const assumptions: EditorialBriefAssumptions = {
    ...(metadata?.assumptions ?? {}),
  }
  const field = metadata?.questionField
  if (!field) return { brief, assumptions }

  if (UNSURE_RE.test(prompt)) {
    brief[field] = DEFAULT_ASSUMPTIONS[field]
    assumptions[field] = DEFAULT_ASSUMPTIONS[field]
    return { brief, assumptions }
  }

  if (!compact(brief[field])) {
    brief[field] = prompt.trim()
  }
  return { brief, assumptions }
}

function buildQuestion(
  field: EditorialBriefField,
  brief: EditorialBrief,
): string {
  switch (field) {
    case "topicOrPassage":
      return "What topic or Scripture passage should this Experience focus on?"
    case "language":
      return "Which language should the generated Experience use?"
    case "audience":
      return "Who is this Experience for?"
    case "desiredOutcome":
      return "What should readers understand, feel, or do after this page?"
    case "tone":
      return "What tone should the page use?"
    case "pageType":
      return "What kind of page should this become?"
    case "scriptureEmphasis":
      return `How should Scripture shape this page${brief.topicOrPassage ? ` around ${brief.topicOrPassage}` : ""}?`
    case "ctaOrNextStep":
      return "What next step or CTA should the page invite readers toward?"
  }
}

export function formatBriefSummary(
  brief: EditorialBrief,
  assumptions: EditorialBriefAssumptions = {},
): string {
  const rows = EDITORIAL_BRIEF_FIELDS.map((field) => {
    const value = brief[field] ?? ""
    const assumed = assumptions[field] ? " (assumption)" : ""
    return `- ${FIELD_LABELS[field]}: ${value}${assumed}`
  })
  return [
    "Here is the editorial brief I will use before generating the draft:",
    "",
    ...rows,
    "",
    "Confirm this brief when you want me to generate the Experience draft.",
  ].join("\n")
}

export function updateBriefFromTurn({
  previous,
  prompt,
}: {
  previous: EditorialBriefMetadata | null
  prompt: string
}): BriefTurnResult {
  const pending = answerPendingQuestion(previous, prompt)
  const extracted = extractBriefAnswers(prompt)
  const brief = mergeBrief(pending.brief, extracted)
  const assumptions = pending.assumptions
  const missingFields = missingBriefFields(brief)

  if (missingFields.length === 0) {
    const metadata: EditorialBriefMetadata = {
      kind: "editorial_brief",
      status: "confirmation_required",
      brief,
      assumptions,
      missingFields,
    }
    return {
      metadata,
      content: formatBriefSummary(brief, assumptions),
      confirmationRequired: true,
    }
  }

  const questionField = missingFields[0]
  const question = buildQuestion(questionField, brief)
  const metadata: EditorialBriefMetadata = {
    kind: "editorial_brief",
    status: "collecting",
    brief,
    assumptions,
    missingFields,
    questionField,
    question,
  }
  return {
    metadata,
    content: question,
    confirmationRequired: false,
  }
}

export function confirmedBriefMetadata(
  metadata: EditorialBriefMetadata,
): EditorialBriefMetadata {
  return {
    ...metadata,
    status: "confirmed",
    missingFields: [],
    question: undefined,
    questionField: undefined,
  }
}
