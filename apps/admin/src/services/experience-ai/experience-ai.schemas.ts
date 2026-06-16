import { z } from "zod"

/**
 * Single source of truth for the generation minimum-block-count rule.
 *
 * This minimum is a GENERATION-PATH contract only — an AI-generated draft
 * must contain at least this many top-level blocks to be a usable page.
 * It is enforced at two gates that must agree: the `DraftExperienceSchema`
 * gate inside the workflow (below) AND the post-normalize generation check
 * in `experience-ai-normalize.ts`. Both reference this constant so they can
 * never silently drift apart.
 *
 * It is deliberately NOT applied to the persistence-layer `BlocksSchema`
 * (`@/domain/blocks`) — that schema governs ALL persistence including
 * legitimate manual 1-block experiences, so tightening it would reject
 * valid hand-authored content.
 */
export const GENERATION_MIN_BLOCKS = 2

const DraftSectionRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^s\d{2}$/)

const DraftVideoRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^v\d{2}$/)

const DraftHeadingLevelSchema = z.enum(["h1", "h2", "h3", "h4", "h5", "h6"])

export const DraftBibleQuoteItemSchema = z
  .object({
    reference: z.string().min(1),
    text: z.string().min(1),
    attribution: z.string().optional(),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

export const DraftInfoBlockItemSchema = z
  .object({
    icon: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()

export const DraftMediaCollectionItemSchema = z
  .object({
    candidateRef: DraftVideoRefSchema,
    titleOverride: z.string().optional(),
    subtitleOverride: z.string().optional(),
    labelOverride: z.string().optional(),
    collectionSize: z.string().optional(),
    targetRef: DraftSectionRefSchema.optional(),
  })
  .strict()

export const DraftNavigationCarouselItemSchema = z
  .object({
    targetRef: DraftSectionRefSchema,
    title: z.string().min(1),
    category: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

export const DraftRelatedQuestionItemSchema = z
  .object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict()

export const DraftVideoCarouselItemSchema = z
  .object({
    candidateRef: DraftVideoRefSchema,
    titleOverride: z.string().optional(),
    subtitleOverride: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

export const DraftAdventCountdownBlockSchema = z
  .object({
    t: z.literal("adventCountdown"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    title: z.string().min(1),
    scripture: z.string().optional(),
    scriptureReference: z.string().optional(),
    locale: z.string().optional(),
  })
  .strict()

export const DraftBibleQuotesCarouselBlockSchema = z
  .object({
    t: z.literal("bibleQuotesCarousel"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    quotes: z.array(DraftBibleQuoteItemSchema).default([]),
  })
  .strict()

export const DraftCardBlockSchema = z
  .object({
    t: z.literal("card"),
    sectionRef: DraftSectionRefSchema.optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    backgroundColor: z.string().optional(),
    link: z.string().optional(),
    variant: z.enum(["default", "featured"]).optional(),
  })
  .strict()

export const DraftCtaBlockSchema = z
  .object({
    t: z.literal("cta"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    body: z.string().optional(),
    buttonLabel: z.string().min(1),
    buttonLink: z.string().optional(),
    variant: z.enum(["primary", "secondary"]).optional(),
  })
  .strict()

export const DraftEasterDatesBlockSchema = z
  .object({
    t: z.literal("easterDates"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    easterDatesTitle: z.string().min(1),
    westernEasterLabel: z.string().min(1),
    orthodoxEasterLabel: z.string().min(1),
    passoverLabel: z.string().min(1),
    westernEasterEnabled: z.boolean().optional(),
    orthodoxEasterEnabled: z.boolean().optional(),
    passoverEnabled: z.boolean().optional(),
    locale: z.string().optional(),
  })
  .strict()

export const DraftInfoBlocksBlockSchema = z
  .object({
    t: z.literal("infoBlocks"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    widthPercent: z.number().int().min(1).max(100).optional(),
    intro: z.string().optional(),
    heading: z.string().optional(),
    description: z.string().optional(),
    blocks: z.array(DraftInfoBlockItemSchema).default([]),
  })
  .strict()

export const DraftMediaCollectionBlockSchema = z
  .object({
    t: z.literal("mediaCollection"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    categoryLabel: z.string().optional(),
    variant: z
      .enum(["carousel", "grid", "collection", "hero", "player"])
      .default("collection"),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaLabel: z.string().optional(),
    showItemNumbers: z.boolean().optional(),
    footerText: z.string().optional(),
    items: z.array(DraftMediaCollectionItemSchema).default([]),
  })
  .strict()

export const DraftNavigationCarouselBlockSchema = z
  .object({
    t: z.literal("navigationCarousel"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    items: z.array(DraftNavigationCarouselItemSchema).default([]),
  })
  .strict()

export const DraftPromoBannerBlockSchema = z
  .object({
    t: z.literal("promoBanner"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    widthPercent: z.number().int().min(1).max(100).optional(),
    intro: z.string().optional(),
    heading: z.string().min(1),
    description: z.string().min(1),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().min(1),
  })
  .strict()

export const DraftQuizButtonBlockSchema = z
  .object({
    t: z.literal("quizButton"),
    buttonText: z.string().min(1),
    iframeSrc: z.string().regex(/^https:\/\/[\w.-]+\.nextstep\.is\/.*$/),
  })
  .strict()

export const DraftRelatedQuestionsBlockSchema = z
  .object({
    t: z.literal("relatedQuestions"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    questions: z.array(DraftRelatedQuestionItemSchema).default([]),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().optional(),
  })
  .strict()

export const DraftTextBlockSchema = z
  .object({
    t: z.literal("text"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    headingLevel: DraftHeadingLevelSchema.optional(),
    subtitle: z.string().optional(),
    contentParagraphs: z.array(z.string()).optional(),
    variant: z.enum(["default", "lead", "small"]).optional(),
  })
  .strict()

export const DraftVideoBlockSchema = z
  .object({
    t: z.literal("video"),
    sectionRef: DraftSectionRefSchema.optional(),
    candidateRef: DraftVideoRefSchema,
    clipStartSeconds: z.number().min(0).optional(),
    clipEndSeconds: z.number().min(0).optional(),
    autoplay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    showControls: z.boolean().optional(),
    titleSource: z.enum(["manual", "videoTitle"]).optional(),
    subtitleSource: z.enum(["manual", "videoDescription"]).optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  })
  .strict()

export const DraftVideoCarouselBlockSchema = z
  .object({
    t: z.literal("videoCarousel"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    items: z.array(DraftVideoCarouselItemSchema).default([]),
  })
  .strict()

export const DraftVideoHeroBlockSchema = z
  .object({
    t: z.literal("videoHero"),
    sectionRef: DraftSectionRefSchema.optional(),
    candidateRef: DraftVideoRefSchema,
    ctaEnabled: z.boolean().optional(),
    clipStartSeconds: z.number().min(0).optional(),
    clipEndSeconds: z.number().min(0).optional(),
    autoplay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    showControls: z.boolean().optional(),
    headingSource: z.enum(["manual", "videoTitle"]).optional(),
    subheadingSource: z.enum(["manual", "videoDescription"]).optional(),
    heading: z.string().optional(),
    subheading: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaLabel: z.string().optional(),
  })
  .strict()

export const DraftContainerSlotSpansSchema = z
  .object({
    xs: z.number().int().min(1).max(12).optional(),
    sm: z.number().int().min(1).max(12).optional(),
    md: z.number().int().min(1).max(12).optional(),
    lg: z.number().int().min(1).max(12).optional(),
    xl: z.number().int().min(1).max(12).optional(),
  })
  .strict()

export const DraftContainerSlotSchema = z.lazy(() =>
  z
    .object({
      gridSpan: z.number().int().min(1).max(12).optional(),
      spans: DraftContainerSlotSpansSchema.optional(),
      backgroundColor: z.string().optional(),
      content: z.array(DraftContainerContentBlockSchema).default([]),
    })
    .strict(),
)

export const DraftContainerBlockSchema = z
  .object({
    t: z.literal("container"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    slots: z.array(DraftContainerSlotSchema).default([]),
  })
  .strict()

export const DraftSectionBlockSchema = z
  .object({
    t: z.literal("section"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    backgroundOpacity: z.number().min(0).max(1).optional(),
    dynamicBackgroundImage: z.boolean().optional(),
    staticOverlay: z.boolean().optional(),
    content: z.array(z.lazy(() => DraftSectionContentBlockSchema)).default([]),
  })
  .strict()

export const DraftContainerContentBlockSchema = z.discriminatedUnion("t", [
  DraftMediaCollectionBlockSchema,
  DraftTextBlockSchema,
  DraftRelatedQuestionsBlockSchema,
  DraftCtaBlockSchema,
  DraftBibleQuotesCarouselBlockSchema,
  DraftCardBlockSchema,
  DraftEasterDatesBlockSchema,
  DraftAdventCountdownBlockSchema,
  DraftVideoBlockSchema,
])

export const DraftSectionContentBlockSchema = z.discriminatedUnion("t", [
  DraftMediaCollectionBlockSchema,
  DraftTextBlockSchema,
  DraftPromoBannerBlockSchema,
  DraftInfoBlocksBlockSchema,
  DraftCtaBlockSchema,
  DraftContainerBlockSchema,
  DraftRelatedQuestionsBlockSchema,
  DraftBibleQuotesCarouselBlockSchema,
  DraftCardBlockSchema,
  DraftVideoBlockSchema,
  DraftQuizButtonBlockSchema,
  DraftVideoCarouselBlockSchema,
  DraftNavigationCarouselBlockSchema,
])

export const DraftBlockSchema = z.discriminatedUnion("t", [
  DraftMediaCollectionBlockSchema,
  DraftPromoBannerBlockSchema,
  DraftInfoBlocksBlockSchema,
  DraftCtaBlockSchema,
  DraftVideoHeroBlockSchema,
  DraftContainerBlockSchema,
  DraftTextBlockSchema,
  DraftSectionBlockSchema,
  DraftRelatedQuestionsBlockSchema,
  DraftBibleQuotesCarouselBlockSchema,
  DraftCardBlockSchema,
  DraftEasterDatesBlockSchema,
  DraftAdventCountdownBlockSchema,
  DraftVideoBlockSchema,
  DraftVideoCarouselBlockSchema,
  DraftNavigationCarouselBlockSchema,
])

export const DraftExperienceSchema = z
  .object({
    title: z.string().min(1),
    metaDescription: z.string().min(1),
    blocks: z.array(z.lazy(() => DraftBlockSchema)).min(GENERATION_MIN_BLOCKS),
  })
  .strict()

export type DraftExperience = z.infer<typeof DraftExperienceSchema>
export type DraftBlock = z.infer<typeof DraftBlockSchema>
export type DraftTopLevelBlock = DraftBlock
export type DraftSectionBlock = z.infer<typeof DraftSectionBlockSchema>
export type DraftContainerBlock = z.infer<typeof DraftContainerBlockSchema>
export type DraftSectionContentBlock = z.infer<
  typeof DraftSectionContentBlockSchema
>
export type DraftContainerContentBlock = z.infer<
  typeof DraftContainerContentBlockSchema
>
export type DraftAnyBlock =
  | DraftBlock
  | DraftSectionContentBlock
  | DraftContainerContentBlock

export type VideoCandidate = {
  ref: z.infer<typeof DraftVideoRefSchema>
  videoId: string
  slug: string
  title: string
  description: string | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
  label: string | null
}

export function buildDraftExperienceJsonSchema() {
  if (typeof z.toJSONSchema === "function") {
    return z.toJSONSchema(DraftExperienceSchema)
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "metaDescription", "blocks"],
    properties: {
      title: { type: "string", minLength: 1 },
      metaDescription: { type: "string", minLength: 1 },
      blocks: { type: "array", minItems: 2 },
    },
  }
}

// ---------------------------------------------------------------------------
// Two-phase generation (U3) — skeleton schema + structural validator
// ---------------------------------------------------------------------------
//
// The skeleton phase emits STRUCTURE ONLY: an ordered tree of block
// types/nesting with no content. It is validated against the same
// scoped-nesting/cardinality rules the Draft scope unions encode, BEFORE
// any per-block fill runs (cheap fail-fast). The skeleton + fill schemas
// here are GENERATION-ONLY scaffolding — never persisted, versioned, or
// exposed as a domain contract (the persistence contract stays
// `@/domain/blocks` `BlocksSchema`).

/**
 * Derive the canonical `t` literal set a discriminated-union accepts.
 * Reuses the Draft scope unions as the single source of truth so a
 * schema change there propagates into skeleton validation with zero
 * hand-transcription.
 */
function discriminatorLiterals(
  union: z.ZodDiscriminatedUnion,
): ReadonlySet<string> {
  const literals = new Set<string>()
  for (const option of union.options) {
    const shape = (option as z.ZodObject).shape as Record<string, unknown>
    const tLiteral = shape.t as z.ZodLiteral<string>
    literals.add(tLiteral.value)
  }
  return literals
}

/** Block `t` literals allowed at each nesting scope. */
export const SKELETON_TOP_LEVEL_TYPES = discriminatorLiterals(DraftBlockSchema)
export const SKELETON_SECTION_TYPES = discriminatorLiterals(
  DraftSectionContentBlockSchema,
)
export const SKELETON_CONTAINER_TYPES = discriminatorLiterals(
  DraftContainerContentBlockSchema,
)

/**
 * One skeleton node — structure only. `type` is the block `t` literal;
 * `children` is the ordered list of nested nodes (a `section`'s content
 * blocks or a `container`'s flattened slot content). `sectionRef` mirrors
 * the Draft `sectionRef` so the fill phase can address the node. No
 * content fields exist here by construction.
 */
export type SkeletonNode = {
  type: string
  sectionRef?: string
  children?: SkeletonNode[]
}

const SkeletonNodeSchema: z.ZodType<SkeletonNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1),
      sectionRef: DraftSectionRefSchema.optional(),
      children: z.array(SkeletonNodeSchema).optional(),
    })
    .strict(),
)

/**
 * The skeleton envelope the skeleton agent emits: an ordered tree of
 * nodes. `nodes` is the top-level block sequence. Strict — the skeleton
 * has no scalar fields (title/metaDescription are filled later from
 * the plan + fill phase), only structure.
 */
export const SkeletonSchema = z
  .object({
    nodes: z.array(SkeletonNodeSchema),
  })
  .strict()

export type Skeleton = z.infer<typeof SkeletonSchema>

/**
 * Stable failure codes for `validateSkeleton`. Keyed off these, the
 * workflow throws `WorkflowStepError(step="skeleton")` so the action
 * classifies on the discriminator, never on a message regex.
 */
export type SkeletonValidationFailureCode =
  | "malformed_skeleton"
  | "too_few_top_level_nodes"
  | "unknown_block_type"
  | "illegal_nesting"
  | "missing_children"

export type SkeletonValidationResult =
  | { ok: true; skeleton: Skeleton }
  | {
      ok: false
      code: SkeletonValidationFailureCode
      message: string
    }

/**
 * Which scopes a `section`/`container` node legally nests its children
 * in. `section` children live in section scope; `container` children
 * live in container scope (slots flattened). Leaf node types accept no
 * children.
 */
const NESTING_CHILD_SCOPE: Record<
  "section" | "container",
  ReadonlySet<string>
> = {
  section: SKELETON_SECTION_TYPES,
  container: SKELETON_CONTAINER_TYPES,
}

function validateSkeletonNodes(
  nodes: readonly SkeletonNode[],
  allowed: ReadonlySet<string>,
  scopeLabel: string,
  path: string,
):
  | { ok: true }
  | { ok: false; code: SkeletonValidationFailureCode; message: string } {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const nodePath = `${path}[${i}]`
    if (!allowed.has(node.type)) {
      return {
        ok: false,
        code: "unknown_block_type",
        message: `block type '${node.type}' is not allowed in ${scopeLabel} scope at ${nodePath}`,
      }
    }

    if (node.type === "section" || node.type === "container") {
      const childScope = NESTING_CHILD_SCOPE[node.type]
      const children = node.children ?? []
      // A nesting node with zero children produces an empty section /
      // container — structurally pointless. Require at least one child so
      // the fill phase has content to fill.
      if (children.length === 0) {
        return {
          ok: false,
          code: "missing_children",
          message: `'${node.type}' node at ${nodePath} must declare at least one child`,
        }
      }
      const childResult = validateSkeletonNodes(
        children,
        childScope,
        node.type,
        `${nodePath}.children`,
      )
      if (!childResult.ok) return childResult
    } else if (node.children !== undefined && node.children.length > 0) {
      // Leaf node types (text, cta, video, …) cannot nest children — only
      // `section` / `container` are nesting types. A leaf carrying children
      // is an illegal-nesting signal (e.g. the model put blocks under a
      // `text`).
      return {
        ok: false,
        code: "illegal_nesting",
        message: `leaf block type '${node.type}' at ${nodePath} cannot declare children`,
      }
    }
  }
  return { ok: true }
}

/**
 * Validate a skeleton's STRUCTURE before any content fill (R2).
 *
 * Enforces, against the rules the Draft scope unions encode:
 *  - allowed block types per scope (top / section / container);
 *  - scoped nesting (no `section` inside a `section` — `section` is not
 *    in `SKELETON_SECTION_TYPES`; `quizButton` only in section scope;
 *    `videoHero`/`navigationCarousel`/etc. only top-level);
 *  - cardinality: a nesting node (`section`/`container`) must declare
 *    at least one child; a leaf node must declare none;
 *  - ordering: nodes are validated in declared order and the order is
 *    preserved into the fill phase (the array IS the order);
 *  - minimum size: `>= GENERATION_MIN_BLOCKS` top-level nodes.
 *
 * Returns a typed result — `{ ok: true, skeleton }` or
 * `{ ok: false, code, message }`. Never throws.
 */
export function validateSkeleton(input: unknown): SkeletonValidationResult {
  const parsed = SkeletonSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: "malformed_skeleton",
      message: `skeleton did not satisfy SkeletonSchema: ${parsed.error.message}`,
    }
  }

  const skeleton = parsed.data
  if (skeleton.nodes.length < GENERATION_MIN_BLOCKS) {
    return {
      ok: false,
      code: "too_few_top_level_nodes",
      message: `skeleton has ${skeleton.nodes.length} top-level nodes; minimum is ${GENERATION_MIN_BLOCKS}`,
    }
  }

  const result = validateSkeletonNodes(
    skeleton.nodes,
    SKELETON_TOP_LEVEL_TYPES,
    "top-level",
    "nodes",
  )
  if (!result.ok) return result

  return { ok: true, skeleton }
}

// ---------------------------------------------------------------------------
// Per-variant FILL schemas (U3) — flat single-object content per block type
// ---------------------------------------------------------------------------
//
// The fill phase constrains the model to ONE block variant at a time. Per
// the strict-anyOf learning
// (`docs/solutions/best-practices/openai-strict-anyof-lenient-per-section-parse-20260422.md`),
// each fill schema is a FLAT single object with an enumerated `t`
// discriminator + that variant's fields — NOT an `anyOf` of all variants.
// This is the regime constrained decoders honor most reliably and the
// easiest to coerce.
//
// The fill schemas are exactly the existing Draft per-variant schemas
// re-indexed by their `t` literal. Reusing them (rather than
// re-declaring) keeps the fill contract byte-aligned with the assembled
// Draft contract — a fill that validates against its variant schema is a
// block the assembled draft will accept. The `children`/nesting structure
// comes from the skeleton; fill provides the per-node CONTENT only, so the
// nesting-container schemas (`section`, `container`) are intentionally
// excluded here — their children are filled as their own nodes and the
// parent shell is assembled structurally.

/**
 * The flat fill schema for every fillable block `t` (the leaf + content
 * variants — NOT the nesting shells `section`/`container`, whose content
 * is filled as child nodes and whose shells are assembled structurally).
 *
 * Generation-only. Keyed by the `t` literal so the fill step can look up
 * `FILL_SCHEMAS_BY_TYPE[node.type]` and constrain a single call.
 */
export const FILL_SCHEMAS_BY_TYPE = {
  adventCountdown: DraftAdventCountdownBlockSchema,
  bibleQuotesCarousel: DraftBibleQuotesCarouselBlockSchema,
  card: DraftCardBlockSchema,
  cta: DraftCtaBlockSchema,
  easterDates: DraftEasterDatesBlockSchema,
  infoBlocks: DraftInfoBlocksBlockSchema,
  mediaCollection: DraftMediaCollectionBlockSchema,
  navigationCarousel: DraftNavigationCarouselBlockSchema,
  promoBanner: DraftPromoBannerBlockSchema,
  quizButton: DraftQuizButtonBlockSchema,
  relatedQuestions: DraftRelatedQuestionsBlockSchema,
  text: DraftTextBlockSchema,
  video: DraftVideoBlockSchema,
  videoCarousel: DraftVideoCarouselBlockSchema,
  videoHero: DraftVideoHeroBlockSchema,
} as const

export type FillableBlockType = keyof typeof FILL_SCHEMAS_BY_TYPE

/**
 * Look up the flat fill schema for a block type. Returns `undefined` for
 * the nesting shells (`section`/`container`) and unknown types — the
 * caller assembles those structurally rather than filling them directly.
 */
export function getFillSchemaForType(type: string): z.ZodType | undefined {
  return (FILL_SCHEMAS_BY_TYPE as Record<string, z.ZodType>)[type]
}
