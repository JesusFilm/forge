import type { BackgroundColor } from "./types"

/**
 * Named archetypes that describe the structural "shape" of a generated section.
 * The names are stable identifiers referenced by the template layout and by the
 * AI generator prompts. Do not rename without also updating the generator.
 */
export type ArchetypeName =
  | "VIDEO_HERO"
  | "INTRODUCTION"
  | "VIDEO_CENTRIC"
  | "VIDEO_CAROUSEL"
  | "MEDIA_COLLECTION"

/**
 * Shape descriptor for each archetype — tells a validator / generator which
 * top-level component the archetype produces and (when wrapped) which nested
 * `__component` strings are expected in order.
 *
 * Shapes are derived from /watch/easter, our reference experience.
 */
export const ARCHETYPE_SHAPES = {
  VIDEO_HERO: { topLevel: "sections.video-hero" },
  INTRODUCTION: {
    topLevel: "sections.section",
    content: [
      "sections.navigation-carousel",
      "sections.container",
      "sections.video",
      "sections.container",
      "sections.bible-quotes-carousel",
      "sections.quiz-button",
    ],
  },
  VIDEO_CENTRIC: {
    topLevel: "sections.section",
    content: ["sections.video", "sections.container", "sections.quiz-button"],
  },
  VIDEO_CAROUSEL: {
    topLevel: "sections.section",
    content: ["sections.video-carousel"],
  },
  MEDIA_COLLECTION: {
    topLevel: "sections.section",
    content: ["sections.media-collection"],
  },
} as const

export type ArchetypeShape = (typeof ARCHETYPE_SHAPES)[ArchetypeName]

/**
 * One layout entry in the default template. `sectionKeySuffix` is combined with
 * the experience's theme slug via `buildSectionKey()` to produce the canonical
 * sectionKey for the generated block.
 */
export type TemplateLayoutEntry = {
  archetype: ArchetypeName
  backgroundColor?: BackgroundColor
  sectionKeySuffix: string
}

/**
 * Default 9-block layout modelled on /watch/easter. The AI generator should
 * produce one block per entry, in order. Editors may re-order or swap after
 * publish — this only defines the starting point.
 */
export const EASTER_SHAPED_TEMPLATE_LAYOUT: readonly TemplateLayoutEntry[] = [
  { archetype: "VIDEO_HERO", sectionKeySuffix: "hero" },
  {
    archetype: "INTRODUCTION",
    backgroundColor: "dark",
    sectionKeySuffix: "meaning",
  },
  {
    archetype: "VIDEO_CENTRIC",
    backgroundColor: "default",
    sectionKeySuffix: "video-1",
  },
  {
    archetype: "VIDEO_CAROUSEL",
    backgroundColor: "light",
    sectionKeySuffix: "series",
  },
  {
    archetype: "VIDEO_CENTRIC",
    backgroundColor: "default",
    sectionKeySuffix: "video-2",
  },
  {
    archetype: "VIDEO_CENTRIC",
    backgroundColor: "primary",
    sectionKeySuffix: "video-3",
  },
  {
    archetype: "VIDEO_CAROUSEL",
    backgroundColor: "light",
    sectionKeySuffix: "day-by-day",
  },
  {
    archetype: "VIDEO_CENTRIC",
    backgroundColor: "cosmic",
    sectionKeySuffix: "video-4",
  },
  {
    archetype: "VIDEO_CENTRIC",
    backgroundColor: "default",
    sectionKeySuffix: "invitation",
  },
] as const

/**
 * Trivial deterministic platform ordering for V1 — web and mobile both render
 * blocks in declaration order. Editors can override post-publish via the CMS
 * `platformOrdering` field.
 */
export function computePlatformOrdering(blockCount: number): {
  web: number[]
  mobile: number[]
} {
  const indices: number[] = []
  for (let i = 0; i < blockCount; i++) indices.push(i)
  return { web: [...indices], mobile: [...indices] }
}

/**
 * Build a canonical sectionKey by joining `themeSlug` and `suffix` with `-` and
 * normalizing the result to kebab-case (lowercase, non-alphanumeric → dashes,
 * collapsed repeats, trimmed). Safe to call with user-provided slugs.
 */
export function buildSectionKey(themeSlug: string, suffix: string): string {
  const joined = `${themeSlug}-${suffix}`
  return joined
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
