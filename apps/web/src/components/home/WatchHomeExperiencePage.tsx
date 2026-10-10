import {
  signWatchHomeHeroManifestCatalog,
  signWatchSurfaceManifest,
} from "@/lib/watch-surface-manifest.server"
import {
  authoredWatchSurfaceSource,
  watchHomeHeroSource,
} from "@/lib/watch-surface-manifest.sources"
import { Fragment } from "react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { WatchHomeBodyZone } from "@/components/home/WatchHomeBodyZone"
import { WatchHomeFooter } from "@/components/home/WatchHomeFooter"
import { WatchHomeTvCarousel } from "@/components/home/WatchHomeTvCarousel"
import {
  WatchContinueWatchingRail,
  type WatchContinueWatchingItem,
} from "@/components/home/WatchContinueWatchingRail"
import { WatchExposureBoundary } from "@/components/recommendations/WatchExposureBoundary"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { createInitialDynamicCollectionFeedCacheSignatures } from "@/lib/dynamic-collection-cache-signature"
import {
  boundDynamicCollectionFeedReferences,
  mergeDynamicCollectionFeedExcludedIds,
  type DynamicCollectionFeedCacheScope,
} from "@/lib/dynamic-collection-contract"
import type { WatchHomeModel } from "@/lib/watch-home"
import { collectFeaturedCollectionReferences } from "@/lib/featured-collection-references"
import { enrichMediaItem } from "@/lib/enrichment"

function collectWatchHomeResumeItems(
  blocks: readonly Section[],
): WatchContinueWatchingItem[] {
  const items = new Map<string, WatchContinueWatchingItem>()

  const visit = (block: unknown) => {
    if (typeof block !== "object" || block == null) return
    const candidate = block as {
      readonly __typename?: string | null
      readonly items?: readonly unknown[] | null
      readonly content?: readonly unknown[] | null
      readonly sectionContent?: readonly unknown[] | null
    }

    if (
      candidate.__typename === "MediaCollectionBlock" &&
      Array.isArray(candidate.items)
    ) {
      for (const rawItem of candidate.items) {
        if (typeof rawItem !== "object" || rawItem == null) continue
        const item = enrichMediaItem(
          rawItem as Parameters<typeof enrichMediaItem>[0],
        )
        if (!item.id || !item.title || !item.videoSlug) continue
        items.set(item.id, {
          videoId: item.id,
          title: item.title,
          videoSlug: item.videoSlug,
          languageSlug: item.languageSlug,
          imageUrl: item.imageUrl,
        })
      }
    }

    for (const child of [candidate.content, candidate.sectionContent]) {
      if (Array.isArray(child)) child.forEach(visit)
    }
  }

  blocks.forEach(visit)
  return [...items.values()]
}

type WatchHomeExperiencePageProps = {
  heroModel: WatchHomeModel
  blocks: readonly Section[]
  locale?: string
  languageSlug: string
  publicDocumentPathname?: string
  legacyCategoryRailCompatibility?: boolean
  dynamicCollectionCacheScope?: DynamicCollectionFeedCacheScope
}

const LEGACY_CATEGORY_RAIL_SECTION = {
  __typename: "WatchHomeCategoryRailBlock",
  categoryIds: WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id),
} as unknown as Section

function findBackdropImage(model: WatchHomeModel): {
  url: string
  alt: string
} | null {
  const card =
    model.heroSlides.find((slide) => slide.imageUrl) ??
    model.sections
      .flatMap((section) => section.cards)
      .find((sectionCard) => sectionCard.imageUrl)

  return card?.imageUrl ? { url: card.imageUrl, alt: card.imageAlt } : null
}

function isWatchHomeHeroBlock(block: Section) {
  return (
    (block as { readonly __typename?: string | null }).__typename ===
    "WatchHomeHeroBlock"
  )
}

type PageHeadingCandidate = {
  readonly __typename?: string | null
  readonly content?: readonly Section[] | null
  readonly heading?: string | null
  readonly headingLevel?: string | null
  readonly sectionContent?: readonly Section[] | null
}

function normalizeAuthoredPageHeadings(blocks: readonly Section[]) {
  let hasAuthoredPageHeading = false

  const normalizeBlock = (block: Section): Section => {
    const candidate = block as PageHeadingCandidate

    if (
      candidate.__typename === "TextBlock" &&
      candidate.headingLevel === "h1" &&
      typeof candidate.heading === "string" &&
      candidate.heading.trim().length > 0
    ) {
      if (!hasAuthoredPageHeading) {
        hasAuthoredPageHeading = true
        return block
      }

      return {
        ...(block as unknown as Record<string, unknown>),
        headingLevel: "h2",
      } as unknown as Section
    }

    const nestedKey =
      candidate.__typename === "SectionBlock"
        ? "sectionContent"
        : candidate.__typename === "ContainerBlock"
          ? "content"
          : null
    if (!nestedKey) return block

    const nestedBlocks = candidate[nestedKey]
    if (!nestedBlocks) return block

    const normalizedBlocks = nestedBlocks.map(normalizeBlock)
    if (
      normalizedBlocks.every((nested, index) => nested === nestedBlocks[index])
    ) {
      return block
    }

    return {
      ...(block as unknown as Record<string, unknown>),
      [nestedKey]: normalizedBlocks,
    } as unknown as Section
  }

  return {
    blocks: blocks.map(normalizeBlock),
    hasAuthoredPageHeading,
  }
}

function isStandaloneMediaBlock(block: Section) {
  const typename = (block as { readonly __typename?: string | null }).__typename
  return typename === "VideoBlock" || typename === "VideoCarouselBlock"
}

function isDynamicMediaCollectionBlock(block: Section) {
  const candidate = block as {
    readonly __typename?: string | null
    readonly itemsSource?: string | null
  }

  return (
    candidate.__typename === "MediaCollectionBlock" &&
    candidate.itemsSource === "dynamicCollections"
  )
}

export function WatchHomeExperiencePage({
  heroModel,
  blocks,
  locale = "en",
  languageSlug,
  publicDocumentPathname,
  legacyCategoryRailCompatibility = false,
  dynamicCollectionCacheScope = "live",
}: WatchHomeExperiencePageProps) {
  const t = useTranslations("WatchHome")
  const backdrop = findBackdropImage(heroModel)
  const normalized = normalizeAuthoredPageHeadings(blocks)
  const continueWatchingItems = collectWatchHomeResumeItems(normalized.blocks)
  const hasHeroBlock = normalized.blocks.some(isWatchHomeHeroBlock)
  // The intro is sticky and the body zone scrolls over it, so the carousel has
  // to render OUTSIDE that zone. An authored hero block renders the very same
  // carousel (see `renderBlock`), so hoist it when it leads the page. An
  // authored hero placed mid-page keeps its inline position and simply does
  // not pin — pinning a hero that starts halfway down has no meaning.
  const leadsWithHeroBlock =
    normalized.blocks.length > 0 && isWatchHomeHeroBlock(normalized.blocks[0])
  const heroAboveBodyZone = !hasHeroBlock || leadsWithHeroBlock
  const bodyZoneBlocks = leadsWithHeroBlock
    ? normalized.blocks.slice(1)
    : normalized.blocks
  const featuredCollections = collectFeaturedCollectionReferences(
    normalized.blocks,
  )
  const dynamicCollectionBlock = normalized.blocks.find(
    isDynamicMediaCollectionBlock,
  )
  const boundedFeaturedCollections = {
    ids: featuredCollections.ids,
    slugs: boundDynamicCollectionFeedReferences(featuredCollections.slugs),
  }
  const dynamicCollectionCacheSignatures = dynamicCollectionBlock
    ? createInitialDynamicCollectionFeedCacheSignatures({
        locale,
        languageSlug,
        cacheScope: dynamicCollectionCacheScope,
        excludedIds: mergeDynamicCollectionFeedExcludedIds(
          (
            dynamicCollectionBlock as unknown as {
              excludedVideoIds?: readonly string[] | null
            }
          ).excludedVideoIds,
          boundedFeaturedCollections.ids,
        ),
        excludedSlugs: boundedFeaturedCollections.slugs,
      })
    : undefined
  const dynamicCollections = {
    featuredCollections: boundedFeaturedCollections,
    cacheScope: dynamicCollectionCacheScope,
    cacheSignatures: dynamicCollectionCacheSignatures,
  }
  const compatibilityCategoryRail = legacyCategoryRailCompatibility ? (
    <ExperienceSectionRenderer
      section={LEGACY_CATEGORY_RAIL_SECTION}
      locale={locale}
      languageSlug={languageSlug}
      dynamicCollections={dynamicCollections}
    />
  ) : null

  const renderBlock = (block: Section, index: number) => {
    const blockKey =
      (block as { sectionKey?: string | null }).sectionKey ?? index

    if (isWatchHomeHeroBlock(block)) {
      // Reached only by a hero authored somewhere other than first — a leading
      // one is hoisted above the body zone below. This one renders inside that
      // zone, so it must not pin: it would stick at the viewport top under the
      // very content its coverage check measures against.
      return (
        <Fragment key={blockKey}>
          <WatchHomeTvCarousel
            pinned={false}
            exposurePlacement={`authored-hero-${index}`}
            heroManifestCatalog={
              signWatchHomeHeroManifestCatalog(
                watchHomeHeroSource(heroModel, `authored-hero-${index}`),
              ) ?? undefined
            }
            slides={heroModel.heroSlides}
            sequence={heroModel.carousel}
          />
          {compatibilityCategoryRail}
        </Fragment>
      )
    }

    const renderedBlock = (
      <ExperienceSectionRenderer
        section={block}
        locale={locale}
        languageSlug={languageSlug}
        dynamicCollections={dynamicCollections}
      />
    )
    const typename = (block as { readonly __typename?: string | null })
      .__typename
    const instrumentedBlock =
      typename === "LanguageGlobeBlock" ? (
        <Fragment key={blockKey}>{renderedBlock}</Fragment>
      ) : (
        <WatchExposureBoundary
          key={blockKey}
          manifest={
            signWatchSurfaceManifest(
              authoredWatchSurfaceSource(
                {
                  surface: "watch-home",
                  block: "authored",
                  presentation: "authored-block",
                  placement: `authored-${index}`,
                },
                block,
                languageSlug,
                { publicDocumentPathname },
              ),
            ) ?? undefined
          }
          config={{
            surface: "watch-home",
            block: "authored",
            presentation: "authored-block",
            placement: `authored-${index}`,
          }}
        >
          {renderedBlock}
        </WatchExposureBoundary>
      )

    return isStandaloneMediaBlock(block) ? (
      <div
        key={blockKey}
        className={`${WATCH_PAGE_CONTENT_CLASSES} pt-16`}
        data-watch-home-content-rail
      >
        {instrumentedBlock}
      </div>
    ) : (
      instrumentedBlock
    )
  }

  return (
    <main
      // `overflow-x-clip`, never `overflow-x-hidden`: hidden computes the other
      // axis to `auto`, which makes this element the scroll container and
      // silently stops the hero below from sticking. Clip does not establish a
      // scroll container, so the pin survives.
      className="min-h-screen overflow-x-clip bg-black text-white"
    >
      <div
        className="relative font-sans text-white"
        style={{ minHeight: "100svh" }}
      >
        <div className="sticky top-0 z-[1] mx-auto h-screen max-w-[1920px] overflow-hidden bg-black/10">
          {backdrop ? (
            <Image
              src={backdrop.url}
              alt={backdrop.alt}
              fill
              priority
              sizes="100vw"
              className="scale-110 object-cover opacity-45 blur-sm"
            />
          ) : (
            <div
              aria-hidden
              className="h-full w-full bg-[linear-gradient(135deg,#020617,#3f1d2b_50%,#14332c)]"
            />
          )}
          <div
            aria-hidden
            className="absolute inset-0 bg-black/10"
            style={{ backdropFilter: "brightness(.6) blur(40px)" }}
          />
          <div aria-hidden className="absolute inset-0 bg-black/35" />
        </div>

        {/* No `overflow-x-clip` here: the hero media bleeds past this 1920px
            rail to the viewport edges. `html`/`body` already clip the page,
            so nothing gains a horizontal scrollbar. */}
        <div className="relative z-10 mx-auto -mt-[100vh] max-w-[1920px]">
          {normalized.hasAuthoredPageHeading ? null : (
            <h1 className="sr-only">{t("pageTitle")}</h1>
          )}
          {heroAboveBodyZone ? (
            <WatchHomeTvCarousel
              heroManifestCatalog={
                signWatchHomeHeroManifestCatalog(
                  watchHomeHeroSource(heroModel),
                ) ?? undefined
              }
              slides={heroModel.heroSlides}
              sequence={heroModel.carousel}
            />
          ) : null}
          <WatchHomeBodyZone>
            <WatchContinueWatchingRail
              items={continueWatchingItems}
              fallbackLanguageSlug={languageSlug}
            />
            {heroAboveBodyZone ? compatibilityCategoryRail : null}
            {bodyZoneBlocks.map((block, index) =>
              // Keep the original index so a block without a `sectionKey`
              // keeps the key it had before the hero was hoisted out.
              renderBlock(block, leadsWithHeroBlock ? index + 1 : index),
            )}
            <WatchHomeFooter />
          </WatchHomeBodyZone>
        </div>
      </div>
    </main>
  )
}
