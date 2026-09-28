import "server-only"
import { Children, isValidElement, type ReactNode } from "react"
import Markdown, { defaultUrlTransform } from "react-markdown"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
} from "./routes"
import { resolveWatchShareUrlFromPathname } from "./share"
import { isSeriesRecord } from "./watch-content-kind"
import { isWatchHomeIntroEligibleVideoLabel } from "./watch-home-carousel-sequence"
import {
  resolveWatchHomeTiles,
  type WatchHomeRailTileInput,
} from "./watch-home-tiles"
import type { WatchHomeModel } from "./watch-home"
import type {
  MergedWatchBlock,
  ResolvedSeriesBySlug,
  WatchSiblingCarouselBlock,
  RouteVideo,
} from "./content"
import {
  watchSurfaceItemPath,
  watchSurfaceHrefNeedsDocumentPathname,
  watchSurfaceSource,
  type WatchSurfaceManifest,
  type WatchSurfaceConfig,
  type WatchSurfaceManifestSource,
} from "./watch-surface-manifest"

export const MAX_WATCH_SURFACE_MARKDOWN_BYTES = 48 * 1024

export function watchHomeHeroSource(
  model: WatchHomeModel,
  placement = "home-hero",
): WatchSurfaceManifestSource | null {
  const hrefs = [
    ...model.heroSlides.filter((slide) =>
      isWatchHomeIntroEligibleVideoLabel(slide.videoLabel),
    ),
    ...model.carousel.pools.flatMap((pool) =>
      pool.videos.filter((video) => Boolean(video.src)),
    ),
  ].map((slide) => slide.href)
  const paths = [
    ...new Set(
      hrefs.flatMap((href) => {
        const path = watchSurfaceItemPath(href)
        return path ? [path] : []
      }),
    ),
  ]
  // A hero is one rotating slot. Never truncate the candidate authority.
  if (paths.length > 100) return null
  return {
    surface: "watch-home",
    block: "hero",
    presentation: "hero-card",
    placement,
    items: paths.map((itemPath) => ({ position: 0, itemPath })),
  }
}

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}
function values(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** Null is an explicit coverage gap: unsupported renderers cannot establish served. */
export function authoredWatchSurfaceSource(
  config: WatchSurfaceConfig,
  block: unknown,
  languageSlug: string,
  context: {
    routeVideo?: Pick<RouteVideo, "slug" | "relatedItems"> | null
    publicDocumentPathname?: string
  } = {},
): WatchSurfaceManifestSource | null {
  const publicDocumentPathname =
    context.publicDocumentPathname != null &&
    /^\/(?!\/)[^?#]*$/.test(context.publicDocumentPathname)
      ? context.publicDocumentPathname
      : undefined
  let ambiguousHref = false
  const rawAnchorPath = (href: string | null): string | null => {
    if (
      href != null &&
      watchSurfaceHrefNeedsDocumentPathname(href) &&
      !publicDocumentPathname
    )
      ambiguousHref = true
    return watchSurfaceItemPath(href, false, publicDocumentPathname)
  }
  let markdownBytes = 0
  const markdownPaths = (markdown: string): (string | null)[] | null => {
    markdownBytes += Buffer.byteLength(markdown, "utf8")
    if (markdownBytes > MAX_WATCH_SURFACE_MARKDOWN_BYTES) return null
    try {
      // Compile with the renderer's parser/sanitizer. Raw HTML is text under its
      // default policy; CommonMark references, escapes and autolinks stay exact.
      const tree = Markdown({
        children: markdown,
        urlTransform: defaultUrlTransform,
      })
      const paths: (string | null)[] = []
      const visit = (node: ReactNode) => {
        Children.forEach(node, (child) => {
          if (!isValidElement<{ children?: ReactNode; href?: unknown }>(child))
            return
          if (child.type === "a" && typeof child.props.href === "string") {
            const href = child.props.href
            paths.push(rawAnchorPath(href))
          }
          visit(child.props.children)
        })
      }
      visit(tree)
      return paths
    } catch {
      return null
    }
  }
  const project = (value: unknown): (string | null)[] | null => {
    const data = record(value)
    if (!data) return null
    const kind = text(data.__typename) ?? text(data.t)
    if (
      kind === "MediaCollectionBlock" ||
      kind === "ComponentSectionsMediaCollection" ||
      kind === "mediaCollection"
    ) {
      if (
        data.itemsSource != null &&
        data.itemsSource !== "manual" &&
        data.itemsSource !== "routeVideoChildren"
      )
        return null
      const routeDerived = data.itemsSource === "routeVideoChildren"
      const rawItems = routeDerived
        ? (context.routeVideo?.relatedItems ?? []).filter(
            (item) => item != null,
          )
        : values(data.items)
      // MediaCollection suppresses the entire section, including its CTA.
      if (rawItems.length === 0) return []
      const language =
        tryAsLocaleSlug(languageSlug) ?? tryAsLocaleSlug("english")!
      const parent = tryAsContentSlug(
        routeDerived
          ? (context.routeVideo?.slug ?? "")
          : (text(data.mediaDefaultCollectionSlug) ?? ""),
      )
      const explicit = text(data.mediaCtaLink)
      const cta = explicit?.trim()
        ? explicit
        : parent
          ? `${WATCH_BASE_PATH}${watchVideoPath(parent, language)}`
          : null
      const standalone = cta?.startsWith(`${WATCH_BASE_PATH}/`)
        ? resolveWatchShareUrlFromPathname({
            origin: WATCH_PUBLIC_METADATA_ORIGIN,
            pathname: cta,
          })
        : null
      const ctaPath = rawAnchorPath(
        standalone ? new URL(standalone).pathname : cta,
      )
      const paths = [ctaPath]
      for (const item of rawItems) {
        if (routeDerived && item == null) continue
        const entry = record(item)
        if (!entry) return null
        const slug = tryAsContentSlug(text(entry.videoSlug) ?? "")
        const dubLanguage = record(record(entry.videoDub)?.language)?.slug
        const itemLanguage =
          tryAsLocaleSlug(
            text(entry.languageSlug) ?? text(dubLanguage) ?? "",
          ) ?? language
        paths.push(
          slug
            ? watchSurfaceItemPath(watchVideoPath(slug, itemLanguage))
            : null,
        )
      }
      return paths
    }
    if (kind === "WatchHomeCategoryRailBlock") {
      const locale = tryAsLocaleSlug(languageSlug)
      if (!locale) return []
      const tiles: WatchHomeRailTileInput[] = []
      for (const tile of values(data.tiles)) {
        const entry = record(tile)
        if (!entry) return null
        const fields = [
          "id",
          "categoryId",
          "title",
          "href",
          "icon",
          "style",
        ] as const
        if (
          fields.some(
            (field) => entry[field] != null && typeof entry[field] !== "string",
          )
        )
          return null
        tiles.push(
          Object.fromEntries(
            fields.map((field) => [field, text(entry[field])]),
          ) as WatchHomeRailTileInput,
        )
      }
      const cards = resolveWatchHomeTiles({
        tiles,
        categoryIds: values(data.categoryIds).filter(
          (id): id is string => typeof id === "string",
        ),
        locale,
      })
      return cards.map((card) =>
        watchSurfaceItemPath(card.href, card.kind !== "external"),
      )
    }
    if (
      kind === "BibleQuotesCarouselBlock" ||
      kind === "ComponentSectionsBibleQuotesCarousel" ||
      kind === "bibleQuotesCarousel"
    ) {
      const paths: (string | null)[] = []
      for (const quote of values(data.quotes)) {
        if (quote == null) continue
        const entry = record(quote)
        if (!entry) return null
        // Only free resource cards (truthy CTA label) render an anchor.
        if (entry.ctaLabel && entry.ctaLink)
          paths.push(rawAnchorPath(text(entry.ctaLink)))
      }
      return paths
    }
    if (
      kind === "SectionBlock" ||
      kind === "section" ||
      kind === "ComponentSectionsSection" ||
      kind === "ContainerBlock" ||
      kind === "container" ||
      kind === "ComponentSectionsContainer"
    ) {
      let children: readonly unknown[]
      if (
        kind === "SectionBlock" ||
        kind === "section" ||
        kind === "ComponentSectionsSection"
      )
        children = values(data.sectionContent ?? data.content)
      else if (values(data.slots).length)
        children = values(data.slots).flatMap((slot) =>
          values(record(slot)?.content),
        )
      else {
        let inSlot = false
        children = values(data.content).filter((child) => {
          const childKind = record(child)?.__typename ?? record(child)?.t
          if (
            childKind === "ContainerSlotBlock" ||
            childKind === "containerSlot"
          ) {
            inSlot = true
            return false
          }
          return inSlot
        })
      }
      const paths: (string | null)[] = []
      for (const child of children) {
        const projected = project(child)
        if (projected === null) return null
        paths.push(...projected)
      }
      return paths
    }
    if (
      kind === "PromoBannerBlock" ||
      kind === "ComponentSectionsPromoBanner" ||
      kind === "promoBanner"
    )
      return data.promoCtaLink ? [rawAnchorPath(text(data.promoCtaLink))] : []
    if (
      kind === "CtaBlock" ||
      kind === "ComponentSectionsCta" ||
      kind === "cta"
    )
      return data.buttonLink ? [rawAnchorPath(text(data.buttonLink))] : []
    if (
      kind === "VideoHeroBlock" ||
      kind === "ComponentSectionsVideoHero" ||
      kind === "videoHero"
    )
      return data.ctaLabel && data.ctaLink
        ? [rawAnchorPath(text(data.ctaLink))]
        : []
    if (
      [
        "InfoBlocksBlock",
        "infoBlocks",
        "ComponentSectionsInfoBlocks",
        "NavigationCarouselBlock",
        "navigationCarousel",
        "ComponentSectionsNavigationCarousel",
        "AdventCountdownBlock",
        "adventCountdown",
        "EasterDatesBlock",
        "easterDates",
        "VideoBlock",
        "video",
        "ComponentSectionsVideo",
        "VideoCarouselBlock",
        "videoCarousel",
        "ComponentSectionsVideoCarousel",
        "CardBlock",
      ].includes(kind ?? "")
    )
      return []
    if (
      kind === "TextBlock" ||
      kind === "text" ||
      kind === "ComponentSectionsText"
    ) {
      if (data.textVariant !== "promotional") return []
      const paragraphs = values(data.contentParagraphs)
      if (paragraphs.some((paragraph) => typeof paragraph !== "string"))
        return null
      return markdownPaths(
        paragraphs
          .filter(
            (paragraph): paragraph is string =>
              typeof paragraph === "string" && paragraph.trim().length > 0,
          )
          .join("\n\n"),
      )
    }
    if (
      kind === "RelatedQuestionsBlock" ||
      kind === "ComponentSectionsRelatedQuestions" ||
      kind === "relatedQuestions"
    ) {
      const questions = values(data.questions).filter(
        (question) => question != null,
      )
      if (questions.length === 0) return []
      const paths: (string | null)[] = [
        data.ctaLink ? rawAnchorPath(String(data.ctaLink)) : null,
      ]
      for (const question of questions) {
        const entry = record(question)
        if (
          !entry ||
          (entry.answer != null && typeof entry.answer !== "string")
        )
          return null
        const answerPaths = markdownPaths(text(entry.answer) ?? "")
        if (answerPaths === null) return null
        paths.push(...answerPaths)
      }
      return paths
    }
    // These synthetic recommendation blocks have their own request-owned facts.
    if (
      kind === "HomepageRecommendationsBlock" ||
      kind === "VideoRecommendationsBlock"
    )
      return []
    return null
  }
  const paths = project(block)
  return paths === null || ambiguousHref
    ? null
    : watchSurfaceSource(config, paths, false)
}

export function watchChaptersSource(
  block: WatchSiblingCarouselBlock,
  index: number,
  languageSlug: string,
): WatchSurfaceManifestSource | null {
  const config: WatchSurfaceConfig = {
    surface: "watch-video",
    block: "chapters",
    presentation: "carousel",
    placement: `chapters-${index}`,
  }
  const routableChildren = (
    parent: WatchSiblingCarouselBlock["canonicalParent"],
  ) =>
    (parent.children ?? []).filter(
      (child) =>
        child != null &&
        typeof child.slug === "string" &&
        child.slug.length > 0,
    )
  const initialParent = block.selectableParents?.[0] ?? block.canonicalParent
  // With fewer than two slug-bearing children no selector, title or card mounts.
  if (routableChildren(initialParent).length < 2)
    return { ...config, items: [] }
  if ((block.selectableParents?.length ?? 0) > 1) {
    const language = tryAsLocaleSlug(languageSlug)
    if (!language) return null
    const items: WatchSurfaceManifest["items"] = []
    const identities = new Set<string>()
    for (const parent of block.selectableParents ?? []) {
      const children = routableChildren(parent)
      if (children.length < 2) continue
      const parentSlug = tryAsContentSlug(parent.slug ?? "")
      const paths = children.flatMap((child) => {
        const slug = tryAsContentSlug(child?.slug ?? "")
        return parentSlug && slug
          ? [
              watchSurfaceItemPath(
                watchEpisodePath(parentSlug, slug, language),
              )!,
            ]
          : []
      })
      for (const [position, itemPath] of paths.entries()) {
        if (position >= 100) break
        const identity = `${position}:${itemPath}`
        if (!identities.has(identity)) {
          identities.add(identity)
          items.push({ position, itemPath })
        }
      }
    }
    if (items.length > 100) return null
    return {
      surface: "watch-video",
      block: "chapters",
      presentation: "carousel",
      placement: `chapters-${index}`,
      items,
    }
  }
  const parent = block.selectableParents?.[0] ?? block.canonicalParent
  const slug = tryAsContentSlug(parent.slug ?? "")
  const language = tryAsLocaleSlug(languageSlug)
  const hrefs: (string | null)[] = [
    slug && language ? watchVideoPath(slug, language) : null,
  ]
  for (const child of routableChildren(parent)) {
    const childSlug = tryAsContentSlug(child?.slug ?? "")
    hrefs.push(
      slug && childSlug && language
        ? watchEpisodePath(slug, childSlug, language)
        : null,
    )
  }
  return watchSurfaceSource(
    {
      surface: "watch-video",
      block: "chapters",
      presentation: "carousel",
      placement: `chapters-${index}`,
    },
    hrefs,
  )
}

export function watchVideoSurfaceSources(
  blocks: readonly MergedWatchBlock[],
  languageSlug: string,
): (WatchSurfaceManifestSource | null)[] {
  const ordered = [
    ...blocks.filter((block) => "kind" in block && block.kind === "HeroPlayer"),
    ...blocks.filter(
      (block) => !("kind" in block && block.kind === "HeroPlayer"),
    ),
  ]
  return ordered.map((block, index) =>
    "kind" in block
      ? block.kind === "SiblingCarousel"
        ? watchChaptersSource(block, index, languageSlug)
        : null
      : authoredWatchSurfaceSource(
          {
            surface: "watch-video",
            block: "editorial",
            presentation: "authored-block",
            placement: `editorial-${index}`,
          },
          block,
          languageSlug,
        ),
  )
}

export function watchSeriesEpisodesSource(
  series: ResolvedSeriesBySlug["video"],
  languageSlug: string,
): WatchSurfaceManifestSource {
  const language = tryAsLocaleSlug(languageSlug)
  const parent = tryAsContentSlug(series.slug ?? "")
  const hrefs = (series.children ?? []).flatMap((child) => {
    if (!child?.slug) return []
    const slug = tryAsContentSlug(child.slug)
    return [
      slug && language
        ? isSeriesRecord(child)
          ? watchVideoPath(slug, language)
          : parent
            ? watchEpisodePath(parent, slug, language)
            : null
        : null,
    ]
  })
  return watchSurfaceSource(
    {
      surface: "watch-series",
      block: "episodes",
      presentation: "episode-grid",
      placement: "series-episodes",
    },
    hrefs,
  )
}
