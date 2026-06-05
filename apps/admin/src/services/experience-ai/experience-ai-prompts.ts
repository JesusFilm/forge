/**
 * Pure string-builder module for the Experience AI drafting prompt.
 * No IO, no Prisma. Imported by `experience-ai.service.ts` to assemble
 * the system content for both the OpenRouter / OpenAI chat path and
 * the Codex CLI path.
 *
 * The structural directives must stay identical across providers — the
 * service composes them by concatenation, so mutating any export here
 * affects every provider in lockstep.
 */

/**
 * High-level editorial brief: tone, voice, and length expectations.
 * Locale-agnostic; locale-specific copy guidance is layered on top via
 * {@link localeCopyGuidance}.
 */
export const SYSTEM_BRIEF = `You are an editorial designer drafting a first-pass admin experience for the JesusFilm Forge platform.

Editorial voice: warm, plain-spoken, invitational. Write for a curious general reader, not a theology student. Keep paragraphs short (2-4 sentences). Avoid stock phrases and avoid stacking adjectives.

Composition discipline: produce a layered page that feels close to a hand-crafted experience — not a single-block skeleton. Lean on cross-block carousels and sections to give the page rhythm.`

/**
 * Structural template the model must follow. Mirrors the editorial
 * shape used by the curated Easter (`feat-029`) and Christmas
 * (`feat-034`) experiences without binding to any specific theme.
 */
export const STRUCTURAL_TEMPLATE = `Structural template — every draft MUST contain at minimum:

1. Open with a videoHero block referencing one of the provided candidates (the strongest by relevance).
2. Follow with 2-4 section blocks. Each section should wrap one of:
   - navigationCarousel (links to other sections inside the draft)
   - mediaCollection (curated set of candidate videos)
   - videoCarousel (horizontal scroll of candidate videos)
   - container (mixed slot content: text + video + cta)
3. Close with a quizButton or cta block when the prompt invites a response or reflection.

Cross-block linking: at least one navigationCarousel item MUST reference a sectionRef emitted by another block in the same draft (use the s01, s02, ... refs you assign).

Block diversity: a draft with only one block kind is unacceptable. Aim for at least three distinct block kinds across the page.`

/**
 * Hand-written truncated draft AST mirroring the Christmas seed shape:
 * videoHero + section[navigationCarousel] + section[mediaCollection].
 *
 * Shape only, NOT theme. Copy is intentionally neutral so the model
 * borrows structure (block nesting, sectionRef linking, candidateRef
 * usage) without inheriting Christmas tone. Candidate refs use the
 * generic v01 / v02 aliases the catalog assigns.
 *
 * Frozen so accidental mutation surfaces immediately.
 */
export const FEW_SHOT_EXAMPLE = Object.freeze({
  title: "Example Title",
  metaDescription: "Example meta description for the experience.",
  blocks: [
    {
      t: "videoHero",
      sectionRef: "s01",
      candidateRef: "v01",
      heading: "Headline",
      subheading: "One-line subheading.",
      ctaEnabled: true,
      ctaLabel: "Watch now",
    },
    {
      t: "section",
      sectionRef: "s02",
      content: [
        {
          t: "navigationCarousel",
          items: [
            { targetRef: "s03", title: "Jump to topic" },
            { targetRef: "s01", title: "Back to top" },
          ],
        },
      ],
    },
    {
      t: "section",
      sectionRef: "s03",
      content: [
        {
          t: "mediaCollection",
          variant: "collection",
          title: "More to watch",
          items: [{ candidateRef: "v01" }, { candidateRef: "v02" }],
        },
      ],
    },
  ],
} as const)

const FEW_SHOT_SERIALIZED = JSON.stringify(FEW_SHOT_EXAMPLE)

/**
 * Few-shot block, prefixed with the load-bearing "shape only" caveat.
 * Kept under 1 KB serialized to bound per-call token cost.
 */
export const FEW_SHOT_SECTION = `Few-shot example (shape only — borrow the structure, NOT the copy or theme):
${FEW_SHOT_SERIALIZED}`

const LOCALE_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: "English",
  es: "Spanish (español)",
  fr: "French (français)",
  pt: "Portuguese (português)",
  de: "German (Deutsch)",
  it: "Italian (italiano)",
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  ar: "Arabic (العربية)",
  hi: "Hindi (हिन्दी)",
  ru: "Russian (русский)",
  th: "Thai (ภาษาไทย)",
}

function languageNameFor(locale: string): string {
  const base = locale.toLowerCase().split(/[-_]/)[0] ?? locale
  return LOCALE_LANGUAGE_NAMES[base] ?? `the ${locale} locale`
}

/**
 * Locale-aware copy guidance. Always mentions the language by name so
 * the directive is unambiguous to the model.
 */
export function localeCopyGuidance(locale: string): string {
  const name = languageNameFor(locale)
  if (locale === "en" || locale.toLowerCase().startsWith("en")) {
    return `Write ALL generated copy in English. Use natural, conversational English. Do not slip into other languages, even for proper nouns where translation is conventional.`
  }
  return `Write ALL generated copy in ${name} (locale code: ${locale}). Match the register and idioms of a fluent native speaker. Do NOT default to English phrasing — translate fully, including headings, subtitles, CTAs, and meta description.`
}

const INVARIANTS = `Invariants the draft MUST satisfy (the response will be rejected otherwise):
- Every candidateRef must be one of the v01, v02, ... refs in the input videoCandidates list. Never invent a ref.
- Every targetRef on a navigationCarousel item must match a sectionRef that this draft itself emits.
- Section refs use the form sNN (s01, s02, ...). Video refs use the form vNN.
- Output strict JSON only. No markdown fences, no commentary, no prose outside the JSON object.
- The blocks array must contain at least 2 entries.`

/**
 * Build the full system prompt for a generation call. Provider-agnostic;
 * the OpenRouter / OpenAI chat path passes this as the system message
 * content, the Codex CLI path concatenates it with the JSON schema and
 * input payload.
 */
export function buildSystemPrompt(locale: string): string {
  return [
    SYSTEM_BRIEF,
    "",
    STRUCTURAL_TEMPLATE,
    "",
    localeCopyGuidance(locale),
    "",
    INVARIANTS,
    "",
    FEW_SHOT_SECTION,
  ].join("\n")
}
