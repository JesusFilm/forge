/**
 * Chat-mode prompt builder for the Experience editor AI chat panel.
 *
 * Chat mode is the primary AI authoring surface: on a populated canvas it
 * proposes targeted iterative mutations. Empty-canvas first drafts are
 * handled by the quality-first brief workflow (the Mastra draft/quick-draft
 * workflows) before this prompt is used.
 *
 * Pure string-builder. No IO. The service composes the system message
 * + recent thread history + retrieved video candidates + the new user
 * prompt and pipes the whole thing to Codex on stdin.
 */

import type { VideoCandidate } from "@forge/experience-schema"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

export type ChatHistoryTurn = {
  role: "user" | "assistant" | "system"
  content: string
}

export type EditableLocaleSummary = {
  locale: string
  /** Effective draft value, not only the canonical locale row. */
  isHomepage: boolean
  title: string
  metaDescription: string | null
  ogImageUrl: string | null
  blocksPreview: unknown[]
}

/**
 * Maximum number of historic turns to include in a chat prompt. Older
 * turns are dropped silently. The bound exists to (a) keep per-call token
 * cost predictable and (b) avoid runaway prompt growth for long-running
 * threads. 20 turns covers a typical drafting session; longer threads
 * are usually a sign the operator should fork into a new thread anyway.
 */
export const MAX_HISTORY_TURNS = 20

/**
 * Hard cap on cumulative history character length. Bytes ~ chars for
 * Latin-script content; bilingual sessions trade off a little against
 * this. 50KB ~= ~12k tokens, well under typical context windows.
 */
export const MAX_HISTORY_CHARS = 50_000

const CHAT_SYSTEM_BRIEF = `You are an editorial assistant for the JesusFilm Forge admin app, helping an editor create and refine an Experience page through conversation.

Editorial voice: warm, plain-spoken, invitational. Keep paragraphs short (2-4 sentences). Match the locale of the page when proposing copy.

Working contract:
- Your job is to PROPOSE mutations, then explain them. The editor reviews and the system applies them.
- If the current editable state has no blocks AND the editor's prompt asks to create, draft, generate, build, or start an experience, propose a FULL initial draft inline: set "title", "metaDescription", AND a complete "blocks" array (typically 4-8 blocks: a videoHero or text intro, 1-3 content sections, and a cta near the end). Use whatever topic / audience / tone / Scripture / CTA cues the editor included in the prompt — do NOT defer to a brief flow.
- If the current editable state already has blocks, prefer focused edits to the existing page instead of replacing everything unless the editor explicitly asks for a rewrite.
- If the editor asks to add or insert a section/block on a populated canvas, preserve every existing top-level block in the same order by default. Return "mutations.blocks" as the complete existing blocks array plus exactly the requested new top-level block inserted in the most natural position. Do not rename, reorder, replace, or rewrite existing blocks unless the editor explicitly asks.
- Each turn you may emit a short natural-language reply. End the turn with a single JSON envelope describing the mutation you propose, on its own line. Nothing else after the envelope.
- The envelope is the ONLY thing applied; freeform text before it is shown to the editor as your reasoning.
- Output the envelope as one line of strict JSON (no markdown fences, no commentary inside it).`

const CHAT_INVARIANTS = `Invariants the proposal MUST satisfy (the response will be rejected otherwise):
- You MUST NEVER propose changes to slug. The slug is owned by the editor and immutable from chat.
- The envelope object MUST have exactly the keys: "mutations" (object) plus optionally "localesAffected" (array of locale codes) and "reason" (short string). Any other key triggers a schema_violation rejection.
- "mutations" may contain only: "title" (string), "metaDescription" (string|null), "blocks" (array of block objects matching the editor block schema), "ogImageUrl" (string URL or null). Omit a key to leave it unchanged.
- If a change affects more than the active locale, set "localesAffected" to the full list. The editor will be asked to confirm cross-locale writes; do not silently widen the blast radius.
- Output exactly ONE JSON envelope, on the FINAL line of the response. No trailing text.
- Reference only video candidates that appear in the input list. Use candidate "videoId" values in block "videoId" fields; "ref" is only a human-readable handle.`

const ENVELOPE_SHAPE_HINT = `Envelope shape (illustrative — values vary):
{"mutations":{"title":"New Title","metaDescription":"New description"},"localesAffected":["en"],"reason":"Tightened the hook copy."}`

const BLOCK_KIND_REFERENCE = `Block kinds (the "t" discriminator on each block must be one of these literals — anything else triggers schema_violation). Every block schema is STRICT: only the listed fields are allowed. Only omit optional/defaulted fields; required fields in the examples must be present. Never add a field not shown.

Top-level: "videoHero" | "watchHomeCategoryRail" | "text" | "video" | "card" | "cta" | "infoBlocks" | "mediaCollection" | "navigationCarousel" | "videoCarousel" | "videoRecommendations" | "promoBanner" | "bibleQuotesCarousel" | "adventCountdown" | "easterDates" | "relatedQuestions" | "section" | "container"
Inside section.content: "mediaCollection" | "text" | "promoBanner" | "infoBlocks" | "cta" | "container" | "relatedQuestions" | "bibleQuotesCarousel" | "card" | "video" | "quizButton" | "videoCarousel" | "navigationCarousel". Do not put "videoHero", "videoRecommendations", or another "section" inside section.content.
"sectionKey" is an OPTIONAL string identifier on every block — use it when you need to anchor a navigationCarousel item to a section. Otherwise omit.

Block shape reference (CANONICAL — fields not listed are not accepted):

videoHero:
  {"t":"videoHero","useRouteVideo":false,"videoId":"<cuid>","heading":"Headline","subheading":"One-line subhead","ctaEnabled":true,"ctaLabel":"Watch now","ctaLink":"/path"}
  - "videoId" is the cuid of an admin Video (use the "videoId" field from a candidate, NOT the ref or slug).
  - "ctaLink" is a relative path string, not a URL.

text:
  {"t":"text","heading":"Optional Heading","headingLevel":"h2","subtitle":"Optional sub","contentParagraphs":["First paragraph.","Second paragraph."],"variant":"default"}
  - text uses "contentParagraphs" (array of strings), NOT "body".

video:
  {"t":"video","videoId":"<cuid>","title":"Optional manual title","subtitle":"Optional manual subtitle","showControls":true}
  - "videoId" is the candidate videoId. DO NOT use "candidateRef", "ref", or "id".

card:
  {"t":"card","title":"Card title","description":"Card description","link":"/optional-path","variant":"default"}
  - REQUIRED: "title" and "description".

cta:
  {"t":"cta","heading":"Take the next step","body":"Short invitation copy.","buttonLabel":"Reflect","buttonLink":"/reflect","variant":"primary"}
  - REQUIRED: "buttonLabel" (non-empty string). DO NOT use "ctaLabel" or "ctaHref".
  - "variant" must be "primary" or "secondary".

infoBlocks:
  {"t":"infoBlocks","heading":"What forgiveness can look like","blocks":[{"icon":"heart","title":"Be honest","description":"Bring the real question to Jesus."}]}
  - Nested items live in "blocks", NOT "items".

promoBanner:
  {"t":"promoBanner","heading":"Keep exploring","description":"Take a next step toward forgiveness.","ctaLink":"/next-steps","ctaLabel":"Continue"}
  - REQUIRED: "heading", "description", and "ctaLink".

relatedQuestions:
  {"t":"relatedQuestions","heading":"Questions about forgiveness","questions":[{"question":"What if I still feel hurt?","answer":"Forgiveness can begin honestly, without pretending the pain is gone."}]}
  - Nested items live in "questions", NOT "items". Use "heading", NOT "title".

section (wrapper, cannot nest another section):
  {"t":"section","sectionKey":"s02","content":[{"t":"text","contentParagraphs":["..."]}]}
  - section accepts NO "heading" or "title" field. Put a "text" block at the top of "content" for a section heading.

mediaCollection:
  {"t":"mediaCollection","variant":"grid","thumbnailOrientation":"horizontal","title":"Watch the story","items":[{"videoId":"<cuid>","titleOverride":"Optional item title","labelOverride":"Optional eyebrow label"}]}
  - "variant" REQUIRED: "carousel" | "grid" | "collection" | "hero" | "player".
  - "thumbnailOrientation" OPTIONAL: "horizontal" | "vertical". Use it when the user specifies the card shape.
  - items accept "videoId", "titleOverride", "subtitleOverride", and "labelOverride". DO NOT use "label" on mediaCollection items.

videoCarousel:
  {"t":"videoCarousel","title":"More to watch","items":[{"videoId":"<cuid>","titleOverride":"Optional item title","subtitleOverride":"Optional item subtitle"}]}
  - items accept "videoId", "titleOverride", and "subtitleOverride". DO NOT use "candidateRef" or "ref".

navigationCarousel:
  {"t":"navigationCarousel","items":[{"contentId":"s02","title":"Forgiveness"}]}
  - "contentId" must match the target block/section "sectionKey". DO NOT use "label", "href", or "sectionRef".

watchHomeCategoryRail (homepage-only and top-level only):
  {"t":"watchHomeCategoryRail","categoryIds":["jesus","family","hope"]}
  - This block is allowed only when the current editable state's effective "isHomepage" is true. Do not propose this block when effective isHomepage is false.
  - It is a top-level singleton: it may appear at most once and must never be placed inside section.content or container children.
  - "categoryIds" must be a non-empty, duplicate-free subset of these exact IDs: ${WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => `"${id}"`).join(", ")}.
  - categoryIds order is the rendered tile order. When the editor requests a tile change, keep all unmentioned selections and apply the requested order exactly.
  - If this block already exists, preserve that block and its categoryIds order during unrelated edits. Preserve every unrelated top-level block and its order whenever returning mutations.blocks.

quizButton (only inside section.content):
  {"t":"quizButton","buttonText":"Take the quiz","iframeSrc":"https://demo.nextstep.is/quiz"}
  - REQUIRED: "buttonText" and a valid "https://*.nextstep.is/..." iframeSrc. If no valid Next Step URL is available, use a "cta" block instead.

When referencing a video, use the candidate's "videoId" field as the cuid — never invent ids. The candidate list below provides "ref"/"videoId"/"title"/"description" tuples; pass the videoId through.`

/**
 * Bound the prompt history to MAX_HISTORY_TURNS most-recent turns AND
 * MAX_HISTORY_CHARS cumulative content size. Always preserves order
 * (oldest-first within the window). Returns the trimmed list.
 */
export function trimHistory(
  turns: readonly ChatHistoryTurn[],
): ChatHistoryTurn[] {
  const recent = turns.slice(-MAX_HISTORY_TURNS)
  // Walk back from newest until cumulative chars exceed the budget.
  const out: ChatHistoryTurn[] = []
  let total = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]
    const size = turn.content.length
    if (total + size > MAX_HISTORY_CHARS && out.length > 0) break
    out.unshift(turn)
    total += size
  }
  return out
}

function formatHistory(turns: readonly ChatHistoryTurn[]): string {
  if (turns.length === 0) return "(no prior turns)"
  return turns
    .map((turn) => `[${turn.role.toUpperCase()}]\n${turn.content}`)
    .join("\n\n")
}

function formatCandidates(candidates: readonly VideoCandidate[]): string {
  if (candidates.length === 0) return "(no candidates available)"
  return JSON.stringify(
    candidates.map((c) => ({
      ref: c.ref,
      videoId: c.videoId,
      title: c.title,
      description: c.description,
      label: c.label,
      previewImageUrl: c.previewImageUrl,
      previewStreamUrl: c.previewStreamUrl,
    })),
    null,
    2,
  )
}

function formatLocaleState(state: EditableLocaleSummary): string {
  return JSON.stringify(
    {
      locale: state.locale,
      isHomepage: state.isHomepage,
      title: state.title,
      metaDescription: state.metaDescription,
      ogImageUrl: state.ogImageUrl,
      blocks: state.blocksPreview,
    },
    null,
    2,
  )
}

/**
 * Compose the chat prompt sent to Codex on stdin. Layered as:
 *   system brief → invariants → envelope hint → editable state →
 *   candidate list → trimmed history → fresh user prompt.
 *
 * The active locale is included in the system block so locale-specific
 * voice guidance carries through; cross-locale guards are enforced on
 * the server side regardless of what the model emits.
 */
export function buildChatPrompt({
  state,
  history,
  candidates,
  userPrompt,
}: {
  state: EditableLocaleSummary
  history: readonly ChatHistoryTurn[]
  candidates: readonly VideoCandidate[]
  userPrompt: string
}): string {
  const trimmed = trimHistory(history)
  return [
    CHAT_SYSTEM_BRIEF,
    "",
    `Active locale: ${state.locale}`,
    "",
    CHAT_INVARIANTS,
    "",
    ENVELOPE_SHAPE_HINT,
    "",
    BLOCK_KIND_REFERENCE,
    "",
    "Current editable state:",
    formatLocaleState(state),
    "",
    "Available video candidates (use videoId values as block videoId fields; refs are only human-readable handles):",
    formatCandidates(candidates),
    "",
    "Conversation history (oldest first):",
    formatHistory(trimmed),
    "",
    "[USER]",
    userPrompt.trim(),
    "",
    "[ASSISTANT]",
  ].join("\n")
}
