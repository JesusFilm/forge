"use server"

import type { GeneratedExperience } from "@/lib/ai/experience-schema"
import {
  publishExperience as publishToStrapi,
  type PublishResult,
} from "@/lib/strapi-client"

type Block = Record<string, unknown>

/**
 * Drop blocks or fields that the CMS schema would reject. LLMs (especially
 * the free-form Gemini / Claude CLI paths) sometimes omit required strings
 * like `bibleQuote.reference`. Rather than failing the whole publish, we
 * quietly filter the bad quotes so the rest of the experience still lands.
 */
function sanitizeBlocksForPublish(blocks: unknown[]): Block[] {
  const sanitized: Block[] = []
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue
    const block = { ...(raw as Block) }

    // bible-quotes-carousel: require `reference`, `text`, `imageUrl`,
    // `backgroundColor` on each quote. Drop quotes that don't have them.
    if (block.__component === "sections.bible-quotes-carousel") {
      const rawQuotes = Array.isArray(block.quotes) ? block.quotes : []
      const quotes = rawQuotes
        .filter(
          (q): q is Block => !!q && typeof q === "object" && !Array.isArray(q),
        )
        .map((q) => ({
          ...q,
          reference: typeof q.reference === "string" ? q.reference : "",
          text: typeof q.text === "string" ? q.text : "",
          imageUrl:
            typeof q.imageUrl === "string" && q.imageUrl
              ? q.imageUrl
              : "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900",
          backgroundColor:
            typeof q.backgroundColor === "string" && q.backgroundColor
              ? q.backgroundColor
              : "#1e3a5f",
        }))
        .filter((q) => q.reference && q.text)
      if (quotes.length === 0) continue
      block.quotes = quotes
    }

    // video sections: drop if no streamingUrl (prevents "HLS playlist error"
    // for placeholder URLs on /watch).
    if (
      (block.__component === "sections.video" ||
        block.__component === "sections.video-hero") &&
      (typeof block.streamingUrl !== "string" || !block.streamingUrl)
    ) {
      continue
    }

    sanitized.push(block)
  }
  return sanitized
}

/**
 * AI providers (Gemini / Claude CLI / Codex / Ollama) emit flat blocks by
 * default — `[VideoHero, Text, Video, Video, BibleQuotes]` with no wrapping
 * `sections.section`. Rendered verbatim, the child components (Text, Video,
 * BibleQuotes) have no container padding and run edge-to-edge, unlike the
 * hand-crafted `/watch/easter` reference which wraps every block in a
 * `ComponentSectionsSection` with `backgroundColor` + padding.
 *
 * We wrap flat output in Section wrappers at publish time so the stored
 * layout matches the easter template and the existing web renderer handles
 * padding, background, and visual rhythm.
 *
 * Rule:
 *   - `sections.video-hero` stays at the top level (CMS does not allow it
 *     inside a Section's nested dynamic zone).
 *   - Every `sections.video` block anchors a new Section. Any preceding
 *     non-video blocks (e.g. a Text intro) are prepended to that Section's
 *     content.
 *   - Any trailing non-video blocks (bible quotes, related questions) form a
 *     final Section.
 *   - Pre-existing `sections.section` wrappers are passed through unchanged
 *     so the strict-schema path (OpenRouter) still works.
 */
const SECTION_BACKGROUNDS = [
  "default",
  "dark",
  "primary",
  "cosmic",
  "light",
] as const
const SECTION_WRAPPER = "sections.section"
const VIDEO_HERO = "sections.video-hero"
const VIDEO = "sections.video"
const NESTED_ALLOWED = new Set([
  "sections.text",
  "sections.video",
  "sections.video-carousel",
  "sections.related-questions",
  "sections.bible-quotes-carousel",
  "sections.quiz-button",
  "sections.media-collection",
  "sections.container",
  "sections.navigation-carousel",
  "sections.cta",
  "sections.card",
  "sections.info-blocks",
  "sections.promo-banner",
])

function wrapFlatBlocksWithSections(slug: string, blocks: Block[]): Block[] {
  // If the AI already produced wrappers, trust them.
  if (blocks.some((b) => b.__component === SECTION_WRAPPER)) {
    return blocks
  }

  const out: Block[] = []
  let pending: Block[] = []
  let sectionIndex = 0

  const flushSection = () => {
    if (pending.length === 0) return
    const bg = SECTION_BACKGROUNDS[sectionIndex % SECTION_BACKGROUNDS.length]
    out.push({
      __component: SECTION_WRAPPER,
      sectionKey: `${slug}-section-${sectionIndex + 1}`,
      backgroundColor: bg,
      content: pending,
    })
    pending = []
    sectionIndex += 1
  }

  for (const block of blocks) {
    const comp = block.__component
    if (comp === VIDEO_HERO) {
      // Hero always sits at the top level.
      flushSection()
      out.push(block)
      continue
    }
    if (comp === SECTION_WRAPPER) {
      flushSection()
      out.push(block)
      continue
    }
    if (typeof comp !== "string" || !NESTED_ALLOWED.has(comp)) {
      // Unknown component: leave at top level (renderer will skip if
      // unknown, but we don't want to lose possibly-valid blocks).
      flushSection()
      out.push(block)
      continue
    }
    // A Video anchors a new section with any preceding blocks as intro.
    if (comp === VIDEO && pending.length > 0) {
      pending.push(block)
      flushSection()
      continue
    }
    pending.push(block)
  }
  flushSection()

  return out
}

export async function publishExperience(
  experience: GeneratedExperience,
): Promise<PublishResult> {
  const sanitized = sanitizeBlocksForPublish(experience.blocks as unknown[])
  const wrapped = wrapFlatBlocksWithSections(experience.slug, sanitized)
  const clean: GeneratedExperience = {
    ...experience,
    blocks: wrapped as GeneratedExperience["blocks"],
  }
  return publishToStrapi(clean)
}
