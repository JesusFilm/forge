import type {
  Block,
  ContainerContentBlock,
  ContainerSlotBlock,
  SectionContentBlock,
} from "@/domain/blocks"
import { BlocksSchema } from "@/domain/blocks"
import { GENERATION_MIN_BLOCKS } from "@forge/experience-schema"
import type {
  DraftAnyBlock,
  DraftBlock,
  DraftContainerBlock,
  DraftContainerContentBlock,
  DraftExperience,
  DraftSectionBlock,
  DraftSectionContentBlock,
  VideoCandidate,
} from "@forge/experience-schema"

const HERO_DEFAULTS = {
  clipStartSeconds: 0,
  clipEndSeconds: 8,
} as const

const SECTION_DEFAULTS = {
  backgroundOpacity: 0.65,
} as const

const SLOT_SPAN_DEFAULTS: Record<number, { md: number } | undefined> = {
  1: undefined,
  2: { md: 6 },
  3: { md: 4 },
  4: { md: 3 },
}

function findFirstCandidateRefInNestedBlocks(
  blocks: readonly DraftAnyBlock[],
): string | undefined {
  for (const block of blocks) {
    if (block.t === "videoHero" || block.t === "video") {
      return block.candidateRef
    }
    if (block.t === "videoCarousel" || block.t === "mediaCollection") {
      const firstItem = block.items[0]
      if (firstItem?.candidateRef) return firstItem.candidateRef
    }
    if (block.t === "container") {
      for (const slot of block.slots) {
        const found = findFirstCandidateRefInNestedBlocks(slot.content)
        if (found) return found
      }
    }
    if (block.t === "section") {
      const found = findFirstCandidateRefInNestedBlocks(block.content)
      if (found) return found
    }
  }
  return undefined
}

export type NormalizedExperienceDraft = {
  title: string
  metaDescription: string
  blocks: Block[]
}

/**
 * Literal-union of every normalization failure the AI-draft generation path
 * can throw. Consumers (e.g. `generate-draft-action.ts`) classify on `.code`
 * with an exhaustive `switch` + `never` fallthrough, so ADDING a member here
 * is a compile-time forcing function: every exhaustive handler stops compiling
 * until the new code is mapped.
 *
 * - `UNKNOWN_VIDEO_REF` / `UNKNOWN_SECTION_REF` — the model referenced a
 *   candidate/section that does not exist (unresolvable reference).
 * - `DUPLICATE_SECTION_REF` — reserved for a duplicate-section failure.
 * - `INVALID_BLOCKS` — the normalized output failed `BlocksSchema` shape
 *   validation.
 * - `BELOW_MIN_BLOCKS` — the normalized output is shape-valid but has fewer
 *   than `GENERATION_MIN_BLOCKS` top-level blocks (generation-path minimum).
 */
export type ExperienceAiNormalizationErrorCode =
  | "UNKNOWN_VIDEO_REF"
  | "UNKNOWN_SECTION_REF"
  | "DUPLICATE_SECTION_REF"
  | "INVALID_BLOCKS"
  | "BELOW_MIN_BLOCKS"

export class ExperienceAiNormalizationError extends Error {
  constructor(
    readonly code: ExperienceAiNormalizationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ExperienceAiNormalizationError"
  }
}

type PathSegment = string | number
type SectionKeyRegistry = {
  aliases: Map<string, string>
  paths: Map<string, string>
  counts: Map<string, number>
}

function getSectionRef(block: DraftAnyBlock) {
  return "sectionRef" in block ? block.sectionRef : undefined
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) return false
      if (typeof entry === "string") return entry.trim().length > 0
      if (Array.isArray(entry)) return entry.length > 0
      return true
    }),
  ) as T
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase()
}

function buildSectionKey(
  sectionRef: string | undefined,
  path: readonly PathSegment[],
): string {
  if (sectionRef) {
    return `ai-${normalizeAlias(sectionRef)}`
  }
  return `ai-${path.join("-")}`
}

function pathId(path: readonly PathSegment[]) {
  return path.join("/")
}

function registerSectionKeys(
  blocks: readonly DraftAnyBlock[],
  sectionKeys: SectionKeyRegistry,
  path: readonly PathSegment[] = [],
) {
  blocks.forEach((block, index) => {
    const blockPath = [...path, index]
    const sectionRef = getSectionRef(block)
    if (sectionRef) {
      const alias = normalizeAlias(sectionRef)
      const seenCount = sectionKeys.counts.get(alias) ?? 0
      const key =
        seenCount === 0
          ? buildSectionKey(sectionRef, blockPath)
          : `${buildSectionKey(sectionRef, blockPath)}-${blockPath.join("-")}`
      sectionKeys.counts.set(alias, seenCount + 1)
      sectionKeys.paths.set(pathId(blockPath), key)
      if (seenCount === 0) {
        sectionKeys.aliases.set(alias, key)
      }
    }

    if (block.t === "section") {
      registerSectionKeys(block.content, sectionKeys, [...blockPath, "content"])
    } else if (block.t === "container") {
      block.slots.forEach((slot, slotIndex) => {
        registerSectionKeys(slot.content, sectionKeys, [
          ...blockPath,
          "slot",
          slotIndex,
        ])
      })
    }
  })
}

function resolveSectionKey(
  ref: string | undefined,
  sectionKeys: SectionKeyRegistry,
) {
  if (!ref) return undefined
  const sectionKey = sectionKeys.aliases.get(normalizeAlias(ref))
  if (!sectionKey) {
    throw new ExperienceAiNormalizationError(
      "UNKNOWN_SECTION_REF",
      `Unknown section ref "${ref}" in AI draft`,
    )
  }
  return sectionKey
}

function resolveVideoCandidate(
  ref: string,
  candidates: Map<string, VideoCandidate>,
) {
  const candidate = candidates.get(ref)
  if (!candidate) {
    throw new ExperienceAiNormalizationError(
      "UNKNOWN_VIDEO_REF",
      `Unknown video candidate "${ref}" in AI draft`,
    )
  }
  return candidate
}

function toTopLevelSectionKey(
  block: { sectionRef?: string | undefined },
  sectionKeys: SectionKeyRegistry,
  path: readonly PathSegment[],
) {
  return (
    sectionKeys.paths.get(pathId(path)) ??
    buildSectionKey(block.sectionRef, path)
  )
}

function normalizeDraftBlock(
  block: DraftAnyBlock,
  sectionKeys: SectionKeyRegistry,
  candidates: Map<string, VideoCandidate>,
  path: readonly PathSegment[],
): Block | ContainerContentBlock | SectionContentBlock {
  switch (block.t) {
    case "adventCountdown":
      return compactRecord({
        t: "adventCountdown",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        title: block.title,
        scripture: block.scripture,
        scriptureReference: block.scriptureReference,
        locale: block.locale,
      })
    case "bibleQuotesCarousel":
      return compactRecord({
        t: "bibleQuotesCarousel",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        heading: block.heading,
        quotes: block.quotes.map((quote) =>
          compactRecord({
            reference: quote.reference,
            // Reference-first scripture: `text` is optional and absent on
            // generated quotes (apps/web resolves verse text at render).
            text: quote.text,
            // Structured citation identity passes through so the web renderer
            // can resolve verse text by stable book/chapter/verse.
            osisId: quote.osisId,
            chapterStart: quote.chapterStart,
            chapterEnd: quote.chapterEnd,
            verseStart: quote.verseStart,
            verseEnd: quote.verseEnd,
            attribution: quote.attribution,
            ctaEnabled: quote.ctaEnabled,
            ctaLabel: quote.ctaLabel,
            ctaLink: quote.ctaLink,
            backgroundColor: quote.backgroundColor,
          }),
        ),
      })
    case "card":
      return compactRecord({
        t: "card",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        title: block.title,
        description: block.description,
        backgroundColor: block.backgroundColor,
        link: block.link,
        variant: block.variant ?? "default",
      })
    case "cta":
      return compactRecord({
        t: "cta",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        heading: block.heading,
        body: block.body,
        buttonLabel: block.buttonLabel,
        buttonLink: block.buttonLink,
        variant: block.variant ?? "primary",
      })
    case "easterDates":
      return compactRecord({
        t: "easterDates",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        easterDatesTitle: block.easterDatesTitle,
        westernEasterLabel: block.westernEasterLabel,
        orthodoxEasterLabel: block.orthodoxEasterLabel,
        passoverLabel: block.passoverLabel,
        westernEasterEnabled: block.westernEasterEnabled,
        orthodoxEasterEnabled: block.orthodoxEasterEnabled,
        passoverEnabled: block.passoverEnabled,
        locale: block.locale,
      })
    case "infoBlocks":
      return compactRecord({
        t: "infoBlocks",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        widthPercent: block.widthPercent,
        intro: block.intro,
        heading: block.heading,
        description: block.description,
        blocks: block.blocks.map((item) => compactRecord(item)),
      })
    case "mediaCollection":
      return compactRecord({
        t: "mediaCollection",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        categoryLabel: block.categoryLabel,
        variant: block.variant,
        cardOrientation: block.cardOrientation,
        itemsSource: "manual" as const,
        title: block.title,
        subtitle: block.subtitle,
        description: block.description,
        ctaLink: block.ctaLink,
        ctaLabel: block.ctaLabel,
        showItemNumbers: block.showItemNumbers ?? false,
        footerText: block.footerText,
        items: block.items.map((item) => {
          const candidate = resolveVideoCandidate(item.candidateRef, candidates)
          return compactRecord({
            videoId: candidate.videoId,
            imageOverrideUrl: candidate.previewImageUrl ?? undefined,
            titleOverride: item.titleOverride ?? candidate.title,
            subtitleOverride:
              item.subtitleOverride ?? candidate.description ?? undefined,
            labelOverride: item.labelOverride,
            collectionSize: item.collectionSize,
            linkToSectionKey: resolveSectionKey(item.targetRef, sectionKeys),
          })
        }),
      })
    case "navigationCarousel":
      return compactRecord({
        t: "navigationCarousel",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        items: block.items.map((item) =>
          compactRecord({
            contentId: resolveSectionKey(item.targetRef, sectionKeys) as string,
            title: item.title,
            category: item.category,
            backgroundColor: item.backgroundColor,
          }),
        ),
      })
    case "promoBanner":
      return compactRecord({
        t: "promoBanner",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        widthPercent: block.widthPercent,
        intro: block.intro,
        heading: block.heading,
        description: block.description,
        ctaEnabled: block.ctaEnabled,
        ctaLabel: block.ctaLabel,
        ctaLink: block.ctaLink,
      })
    case "quizButton":
      return compactRecord({
        t: "quizButton",
        buttonText: block.buttonText,
        iframeSrc: block.iframeSrc,
      })
    case "relatedQuestions":
      return compactRecord({
        t: "relatedQuestions",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        heading: block.heading,
        questions: block.questions.map((question) => compactRecord(question)),
        ctaEnabled: block.ctaEnabled,
        ctaLabel: block.ctaLabel,
        ctaLink: block.ctaLink,
      })
    case "text":
      return compactRecord({
        t: "text",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        heading: block.heading,
        headingLevel: block.headingLevel,
        subtitle: block.subtitle,
        contentParagraphs: block.contentParagraphs,
        variant: block.variant,
      })
    case "video": {
      const candidate = resolveVideoCandidate(block.candidateRef, candidates)
      return compactRecord({
        t: "video",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        useRouteVideo: false,
        videoId: candidate.videoId,
        streamingUrl: candidate.previewStreamUrl ?? undefined,
        clipStartSeconds: block.clipStartSeconds,
        clipEndSeconds: block.clipEndSeconds,
        autoplay: block.autoplay,
        muted: block.muted,
        loop: block.loop,
        showControls: block.showControls,
        titleSource: block.title ? "manual" : "videoTitle",
        subtitleSource: block.subtitle
          ? "manual"
          : candidate.description
            ? "videoDescription"
            : undefined,
        title: block.title ?? candidate.title,
        subtitle: block.subtitle ?? candidate.description ?? undefined,
      })
    }
    case "videoCarousel":
      return compactRecord({
        t: "videoCarousel",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        itemsSource: "manual" as const,
        title: block.title,
        subtitle: block.subtitle,
        description: block.description,
        items: block.items.map((item) => {
          const candidate = resolveVideoCandidate(item.candidateRef, candidates)
          return compactRecord({
            videoId: candidate.videoId,
            imageOverrideUrl: candidate.previewImageUrl ?? undefined,
            titleOverride: item.titleOverride ?? candidate.title,
            subtitleOverride:
              item.subtitleOverride ?? candidate.description ?? undefined,
            backgroundColor: item.backgroundColor,
          })
        }),
      })
    case "videoHero": {
      const candidate = resolveVideoCandidate(block.candidateRef, candidates)
      const heroClipStartOmitted = block.clipStartSeconds === undefined
      const heroClipEndOmitted = block.clipEndSeconds === undefined
      const fillHeroClipWindow = heroClipStartOmitted && heroClipEndOmitted
      return compactRecord({
        t: "videoHero",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        useRouteVideo: false,
        videoId: candidate.videoId,
        streamingUrl: candidate.previewStreamUrl ?? undefined,
        ctaEnabled: block.ctaEnabled,
        clipStartSeconds: fillHeroClipWindow
          ? HERO_DEFAULTS.clipStartSeconds
          : block.clipStartSeconds,
        clipEndSeconds: fillHeroClipWindow
          ? HERO_DEFAULTS.clipEndSeconds
          : block.clipEndSeconds,
        autoplay: block.autoplay,
        muted: block.muted,
        loop: block.loop,
        showControls: block.showControls,
        headingSource: block.heading ? "manual" : "videoTitle",
        subheadingSource: block.subheading
          ? "manual"
          : candidate.description
            ? "videoDescription"
            : undefined,
        heading: block.heading ?? candidate.title,
        subheading: block.subheading ?? candidate.description ?? undefined,
        ctaLink: block.ctaLink,
        ctaLabel: block.ctaLabel,
      })
    }
    case "container":
      return compactRecord({
        t: "container",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        content: block.slots.flatMap((slot, slotIndex) => {
          const slotCount = block.slots.length
          const balancedSpan = SLOT_SPAN_DEFAULTS[slotCount]
          const filledSpans =
            slot.spans === undefined && balancedSpan !== undefined
              ? balancedSpan
              : slot.spans
          const marker: ContainerSlotBlock = compactRecord({
            t: "containerSlot" as const,
            gridSpan: slot.gridSpan ?? 6,
            spans: filledSpans,
            backgroundColor: slot.backgroundColor,
          })
          const nested = slot.content.map((nestedBlock, nestedIndex) =>
            normalizeDraftBlock(nestedBlock, sectionKeys, candidates, [
              ...path,
              "slot",
              slotIndex,
              nestedIndex,
            ]),
          ) as ContainerContentBlock[]
          return [marker, ...nested]
        }),
      })
    case "section": {
      let resolvedDynamicBackgroundImage: boolean
      if (block.dynamicBackgroundImage === undefined) {
        const firstCandidateRef = findFirstCandidateRefInNestedBlocks(
          block.content,
        )
        const firstCandidate = firstCandidateRef
          ? candidates.get(firstCandidateRef)
          : undefined
        resolvedDynamicBackgroundImage = Boolean(
          firstCandidate?.previewImageUrl,
        )
      } else {
        resolvedDynamicBackgroundImage = block.dynamicBackgroundImage
      }
      const resolvedBackgroundOpacity =
        block.backgroundOpacity === undefined && resolvedDynamicBackgroundImage
          ? SECTION_DEFAULTS.backgroundOpacity
          : block.backgroundOpacity
      return compactRecord({
        t: "section",
        sectionKey: toTopLevelSectionKey(block, sectionKeys, path),
        backgroundColor: block.backgroundColor,
        backgroundOpacity: resolvedBackgroundOpacity,
        dynamicBackgroundImage: resolvedDynamicBackgroundImage,
        staticOverlay: block.staticOverlay ?? false,
        content: block.content.map((nestedBlock, nestedIndex) =>
          normalizeDraftBlock(nestedBlock, sectionKeys, candidates, [
            ...path,
            "content",
            nestedIndex,
          ]),
        ) as SectionContentBlock[],
      })
    }
  }
}

export function normalizeExperienceDraft(
  draft: DraftExperience,
  videoCandidates: VideoCandidate[],
): NormalizedExperienceDraft {
  const candidateMap = new Map(
    videoCandidates.map((candidate) => [candidate.ref, candidate]),
  )
  const sectionKeys: SectionKeyRegistry = {
    aliases: new Map<string, string>(),
    paths: new Map<string, string>(),
    counts: new Map<string, number>(),
  }

  registerSectionKeys(draft.blocks, sectionKeys)

  const blocks = draft.blocks.map((block, index) =>
    normalizeDraftBlock(block, sectionKeys, candidateMap, [index]),
  ) as Block[]

  // `BlocksSchema` is intentionally left permissive: it governs ALL
  // persistence — including legitimate manual experiences that may have a
  // single block — so it carries no global `.min()`. The generation
  // minimum-block-count rule is enforced HERE, on the generation path only,
  // single-sourced from `GENERATION_MIN_BLOCKS` (the same constant the
  // workflow's `DraftExperienceSchema.blocks.min(...)` gate uses).
  const parsed = BlocksSchema.safeParse(blocks)
  if (!parsed.success) {
    throw new ExperienceAiNormalizationError(
      "INVALID_BLOCKS",
      "AI draft did not normalize into a valid admin BlocksSchema payload",
    )
  }

  if (parsed.data.length < GENERATION_MIN_BLOCKS) {
    throw new ExperienceAiNormalizationError(
      "BELOW_MIN_BLOCKS",
      `AI draft normalized into ${parsed.data.length} block(s); generation requires at least ${GENERATION_MIN_BLOCKS}`,
    )
  }

  return {
    title: draft.title.trim(),
    metaDescription: draft.metaDescription.trim(),
    blocks: parsed.data,
  }
}

export type {
  DraftAnyBlock,
  DraftBlock,
  DraftContainerBlock,
  DraftContainerContentBlock,
  DraftSectionBlock,
  DraftSectionContentBlock,
}
