/**
 * Map of shorthand component names to their canonical `sections.*` strings.
 *
 * Small, fast-moving language models like local Ollama instances frequently
 * emit bare names ("video") instead of the fully-qualified Strapi component
 * identifier ("sections.video"). We normalize both forms to the canonical name
 * before validation so downstream consumers never have to guard against it.
 *
 * Keys are matched case-insensitively (after trimming + lowercasing) by
 * `normalizeComponent`. When adding a new allowed component, add both its
 * canonical form and any common short forms.
 */
export const COMPONENT_ALIASES: Record<string, string> = {
  // Canonical forms — keep as-is so round-trips are idempotent.
  "sections.video": "sections.video",
  "sections.video-hero": "sections.video-hero",
  "sections.video-carousel": "sections.video-carousel",
  "sections.section": "sections.section",
  "sections.text": "sections.text",
  "sections.container": "sections.container",
  "sections.related-questions": "sections.related-questions",
  "sections.bible-quotes-carousel": "sections.bible-quotes-carousel",
  "sections.quiz-button": "sections.quiz-button",
  "sections.media-collection": "sections.media-collection",
  "sections.navigation-carousel": "sections.navigation-carousel",
  "sections.cta": "sections.cta",
  "sections.card": "sections.card",
  "sections.info-blocks": "sections.info-blocks",
  "sections.promo-banner": "sections.promo-banner",
  "sections.advent-countdown": "sections.advent-countdown",
  "sections.easter-dates": "sections.easter-dates",

  // Existing short forms (migrated from apps/seed-studio/src/lib/chat/use-chat.ts)
  video: "sections.video",
  "video-hero": "sections.video-hero",
  hero: "sections.video-hero",
  "video-carousel": "sections.video-carousel",
  carousel: "sections.video-carousel",
  text: "sections.text",
  paragraph: "sections.text",
  container: "sections.container",
  "related-questions": "sections.related-questions",
  questions: "sections.related-questions",
  faq: "sections.related-questions",
  "bible-quotes": "sections.bible-quotes-carousel",
  "bible-quotes-carousel": "sections.bible-quotes-carousel",
  quotes: "sections.bible-quotes-carousel",
  scripture: "sections.bible-quotes-carousel",
  "quiz-button": "sections.quiz-button",
  quiz: "sections.quiz-button",

  // New aliases for the wrapper-shaped model.
  section: "sections.section",
  wrapper: "sections.section",
  "media-collection": "sections.media-collection",
  "navigation-carousel": "sections.navigation-carousel",
  navigation: "sections.navigation-carousel",
  cta: "sections.cta",
  card: "sections.card",
  "info-blocks": "sections.info-blocks",
  "promo-banner": "sections.promo-banner",
  "advent-countdown": "sections.advent-countdown",
  "easter-dates": "sections.easter-dates",
}

/**
 * Normalize a raw component string to its canonical `sections.*` name, or
 * return `null` if no alias is known. Input is trimmed and lowercased; both
 * `"Sections.Video"` and `"video"` resolve to `"sections.video"`.
 */
export function normalizeComponent(name: string): string | null {
  if (typeof name !== "string") return null
  const key = name.trim().toLowerCase()
  if (!key) return null
  if (COMPONENT_ALIASES[key]) return COMPONENT_ALIASES[key]
  const bare = key.replace(/^sections?\./, "")
  return COMPONENT_ALIASES[bare] ?? null
}
