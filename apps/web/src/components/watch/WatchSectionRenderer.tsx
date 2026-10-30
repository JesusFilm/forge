"use client"

import { textDirectionForLocale } from "@/lib/locale"

import { Suspense, useId } from "react"
import type { WatchShareFilm } from "@/lib/watch-share-kit"
import dynamic from "next/dynamic"

import type { MuxPlayerRef } from "@forge/video-player"
import { DEFAULT_WATCH_LANGUAGE_SLUG } from "@forge/watch-url-policy/routes"

import {
  type MergedWatchBlock,
  type WatchBlock,
  type WatchStudyQuestionsBlock,
} from "@/lib/content"
import { isWatchBlock } from "@/lib/watch-blocks"
import { ExperienceSectionRenderer } from "@/components/sections"
import { WatchSemanticRecommendations } from "@/components/recommendations/WatchSemanticRecommendations"
import { WatchExposureBoundary } from "@/components/recommendations/WatchExposureBoundary"
import { BibleQuotesSection } from "@/components/watch/BibleQuotesSection"
import { HeroPlayer } from "@/components/watch/HeroPlayer"
import { SiblingCarousel } from "@/components/watch/SiblingCarousel"
import { WatchBody } from "@/components/watch/WatchBody"
import { WatchPlayerLoadingIndicator } from "@/components/watch/WatchPlayerLoadingIndicator"
import type { WatchModalCallbacks } from "@/components/watch/WatchPageClient"
import type { WatchChapterNavigationIntent } from "@/components/watch/chapter-navigation"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { DEFAULT_LOCALE } from "@/lib/locale"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"
import {
  watchAudienceFrame,
  type WatchAudienceResolution,
} from "@/lib/watch-audience-config"
import { WatchRoleTabs } from "@/components/watch/WatchRoleTabs"
import { WatchFindFlowHost } from "@/components/watch/WatchFindLauncher"
import { tryAsLocaleSlug } from "@/lib/routes"
import { useWatchRole, type WatchRole } from "@/components/watch/watch-role"
import { watchGrowFilmContext } from "@/components/watch/watch-grow-film-context"

// Typo guard: literal-union typing fails the type check on misspellings.
//
// `HeroPlayer` is the only top-zone block — it's the sticky cinematic player
// that pins to the viewport while body content slides over it. The
// `SiblingCarousel` was originally part of this zone too, but rendering it
// alongside the sticky hero meant the carousel would scroll over and visually
// "cover" the hero during scroll. Demoting the carousel into the body zone
// keeps it directly below the hero in normal flow, with the rest of the body
// content (WatchBody, StudyQuestions, BibleQuotes, Share) following it.
const WatchAudienceBlock = dynamic(() =>
  import("@/components/watch/WatchAudienceBlock").then(
    (module) => module.WatchAudienceBlock,
  ),
)

const TOP_ZONE_KINDS: Set<WatchBlock["kind"]> = new Set(["HeroPlayer"])

// Per-persona order of the synthetic body blocks (prototype). Kinds missing
// from a list are not rendered for that persona; authored (non-synthetic)
// blocks keep their relative order after the synthetic ones. Applied only
// while the audience frame is shown.
const ROLE_BODY_ORDER: Record<WatchRole, WatchBlock["kind"][]> = {
  explore: [
    "SiblingCarousel",
    "WatchBody",
    "SemanticRecommendations",
    "BibleQuotes",
    "StudyQuestions",
    "Share",
  ],
  grow: [
    "SiblingCarousel",
    "WatchBody",
    "BibleQuotes",
    "SemanticRecommendations",
    "StudyQuestions",
    "Share",
  ],
  share: [
    "SiblingCarousel",
    "WatchBody",
    "SemanticRecommendations",
    "StudyQuestions",
    "Share",
  ],
  partner: [
    "SiblingCarousel",
    "WatchBody",
    "SemanticRecommendations",
    "StudyQuestions",
    "Share",
  ],
}

function orderBodyBlocksForRole<T extends { block: MergedWatchBlock }>(
  entries: T[],
  role: WatchRole,
): T[] {
  const order = ROLE_BODY_ORDER[role]
  const synthetic = entries
    .filter(({ block }) => isWatchBlock(block) && order.includes(block.kind))
    .sort(
      (a, b) =>
        order.indexOf((a.block as WatchBlock).kind) -
        order.indexOf((b.block as WatchBlock).kind),
    )
  const authored = entries.filter(({ block }) => !isWatchBlock(block))
  return [...synthetic, ...authored]
}

import type { SignedWatchSurfaceManifest } from "@/lib/watch-surface-manifest"

export function WatchSectionRenderer({
  audienceEnabled = false,
  audience,
  surfaceManifests,
  blocks,
  shareFilm,
  onRequestShareLanguages,
  downloadButtonLabel,
  downloadError,
  downloadHref,
  downloadPending,
  modalCallbacks,
  onPlayerReady,
  onPlayerActivated,
  onPlayerViewabilityChange,
  languageSlug,
  locale,
  hasSubtitleOptions = false,
  subtitleLanguageCode,
  subtitleLanguageTag,
  shareHref,
  subtitleVttSrc,
  hideBibleQuotes = false,
  pendingChapter,
  coverBlackoutKey,
  coverBlackoutPhase,
  onChapterNavigateIntent,
}: {
  audienceEnabled?: boolean
  /** Published audience configuration; absent keeps the code definitions. */
  audience?: WatchAudienceResolution
  blocks: MergedWatchBlock[]
  shareFilm?: WatchShareFilm
  onRequestShareLanguages?: () => void
  surfaceManifests?: readonly (SignedWatchSurfaceManifest | null)[]
  downloadButtonLabel?: string
  downloadError?: string | null
  downloadHref?: string
  downloadPending?: boolean
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onPlayerActivated?: (initiation: "manual" | "automatic") => void
  onPlayerViewabilityChange?: (visible: boolean) => void
  languageSlug?: string
  locale?: string
  hasSubtitleOptions?: boolean
  subtitleLanguageCode?: string | null
  subtitleLanguageTag?: string | null
  shareHref?: string
  subtitleVttSrc?: string | null
  hideBibleQuotes?: boolean
  pendingChapter?: WatchChapterNavigationIntent | null
  coverBlackoutKey?: string | null
  coverBlackoutPhase?: "covering" | "revealing" | null
  onChapterNavigateIntent?: (intent: WatchChapterNavigationIntent) => void
}) {
  const { role } = useWatchRole()
  const audienceIdBase = useId()
  // WatchBody owns both columns; the standalone StudyQuestions slot
  // renders as a hidden marker to avoid double-mounting.
  const studyQuestionsBlock =
    blocks.find(
      (b): b is WatchStudyQuestionsBlock =>
        isWatchBlock(b) && b.kind === "StudyQuestions",
    ) ?? null

  const topBlocks: MergedWatchBlock[] = []
  const bodyBlocks: MergedWatchBlock[] = []
  for (const block of blocks) {
    if (isWatchBlock(block) && TOP_ZONE_KINDS.has(block.kind)) {
      topBlocks.push(block)
    } else {
      bodyBlocks.push(block)
    }
  }

  // Each body block keeps the index (key, manifest, placement) it had in the
  // incoming order, so persona ordering moves a block without changing its
  // identity or attaching another block's surface manifest.
  const indexedBody = bodyBlocks.map((block, i) => ({
    block,
    index: i + topBlocks.length,
  }))
  const audienceFrame = audienceEnabled ? watchAudienceFrame(audience) : null
  const findLanguage = tryAsLocaleSlug(
    languageSlug ?? DEFAULT_WATCH_LANGUAGE_SLUG,
  )
  const orderedBody = audienceFrame
    ? orderBodyBlocksForRole(indexedBody, role)
    : indexedBody
  // Prototype composition: everything from the persona tabs down sits on one
  // darker, semi-transparent, full-width band so the tabs and the sections
  // they control read as a single region. Without a WatchBody (or with the
  // audience frame off/rejected) the body renders exactly as before.
  const bodyAt = orderedBody.findIndex(
    ({ block }) => isWatchBlock(block) && block.kind === "WatchBody",
  )
  const personaBand =
    audienceFrame && bodyAt !== -1
      ? {
          config: audienceFrame.config,
          sourceLocale: audienceFrame.sourceLocale,
          head: orderedBody.slice(0, bodyAt + 1),
          tail: orderedBody.slice(bodyAt + 1),
        }
      : null
  const findBlock = <K extends WatchBlock["kind"]>(kind: K) =>
    (blocks.find((b) => isWatchBlock(b) && b.kind === kind) ?? null) as Extract<
      WatchBlock,
      { kind: K }
    > | null
  const watchBodyBlock = findBlock("WatchBody")
  const growFilm = watchBodyBlock
    ? watchGrowFilmContext({
        bodyBlock: watchBodyBlock,
        siblingBlock: findBlock("SiblingCarousel"),
        bibleQuotesBlock: findBlock("BibleQuotes"),
        languageSlug: languageSlug ?? DEFAULT_WATCH_LANGUAGE_SLUG,
      })
    : null

  const renderBodyEntry = ({
    block,
    index,
  }: {
    block: MergedWatchBlock
    index: number
  }) => (
    <Suspense key={blockKey(block, index)} fallback={null}>
      <WatchBlockEntry
        block={block}
        manifest={surfaceManifests?.[index] ?? undefined}
        index={index}
        downloadButtonLabel={downloadButtonLabel}
        downloadError={downloadError}
        downloadHref={downloadHref}
        downloadPending={downloadPending}
        studyQuestionsBlock={studyQuestionsBlock}
        modalCallbacks={modalCallbacks}
        onPlayerReady={onPlayerReady}
        onPlayerActivated={onPlayerActivated}
        onPlayerViewabilityChange={onPlayerViewabilityChange}
        languageSlug={languageSlug}
        locale={locale}
        hasSubtitleOptions={hasSubtitleOptions}
        subtitleLanguageCode={subtitleLanguageCode}
        subtitleLanguageTag={subtitleLanguageTag}
        shareHref={shareHref}
        hideBibleQuotes={hideBibleQuotes}
        pendingChapter={pendingChapter}
        coverBlackoutKey={coverBlackoutKey}
        coverBlackoutPhase={coverBlackoutPhase}
        onChapterNavigateIntent={onChapterNavigateIntent}
      />
    </Suspense>
  )

  const audienceBlock = (tabsIdBase: string | undefined) => (
    <WatchAudienceBlock
      audience={audience}
      tabsIdBase={tabsIdBase}
      languageSlug={languageSlug}
      locale={locale}
      shareFilm={shareFilm}
      onRequestShareLanguages={onRequestShareLanguages}
      growFilm={growFilm}
      currentVideoActions={{
        ...(modalCallbacks?.openShare
          ? { share: modalCallbacks.openShare }
          : {}),
        ...(modalCallbacks?.openDownload
          ? { download: modalCallbacks.openDownload }
          : {}),
      }}
    />
  )

  return (
    <>
      {topBlocks.map((block, index) => (
        <Suspense
          key={blockKey(block, index)}
          fallback={
            <div className="relative flex h-[66svh] min-h-[320px] w-full items-center justify-center bg-black md:h-[min(100svh,56.25vw)]">
              <WatchPlayerLoadingIndicator />
            </div>
          }
        >
          <WatchBlockEntry
            block={block}
            manifest={surfaceManifests?.[index] ?? undefined}
            index={index}
            downloadButtonLabel={downloadButtonLabel}
            downloadError={downloadError}
            downloadHref={downloadHref}
            downloadPending={downloadPending}
            studyQuestionsBlock={studyQuestionsBlock}
            modalCallbacks={modalCallbacks}
            onPlayerReady={onPlayerReady}
            onPlayerActivated={onPlayerActivated}
            onPlayerViewabilityChange={onPlayerViewabilityChange}
            languageSlug={languageSlug}
            locale={locale}
            hasSubtitleOptions={hasSubtitleOptions}
            subtitleLanguageCode={subtitleLanguageCode}
            subtitleLanguageTag={subtitleLanguageTag}
            shareHref={shareHref}
            subtitleVttSrc={subtitleVttSrc}
            hideBibleQuotes={hideBibleQuotes}
            pendingChapter={pendingChapter}
            coverBlackoutKey={coverBlackoutKey}
            coverBlackoutPhase={coverBlackoutPhase}
            onChapterNavigateIntent={onChapterNavigateIntent}
          />
        </Suspense>
      ))}
      {bodyBlocks.length > 0 ? (
        <section
          data-testid="watch-body-zone"
          className="relative w-full text-white"
        >
          <div
            data-testid="watch-body-backdrop"
            className="watch-body-backdrop relative w-full overflow-visible backdrop-blur-2xl md:overflow-hidden"
          >
            <div
              data-testid="watch-body-texture"
              className="absolute inset-0 z-1 bg-repeat opacity-30 mix-blend-multiply"
              style={{ backgroundImage: 'url("/watch/images/overlay.svg")' }}
              aria-hidden="true"
            />
            {personaBand ? (
              <>
                <div
                  // z-3: lets the selected tab's tail paint OVER the band below.
                  className={`relative z-3 flex flex-col items-stretch justify-center gap-6 pt-2 pb-0 ${WATCH_PAGE_CONTENT_CLASSES}`}
                >
                  {personaBand.head.map(renderBodyEntry)}
                  {/* Tabs sit ABOVE the band's top edge; the band starts right under them. */}
                  <div
                    lang={personaBand.sourceLocale}
                    dir={textDirectionForLocale(personaBand.sourceLocale)}
                  >
                    <WatchRoleTabs
                      className="mt-2"
                      idBase={audienceIdBase}
                      config={personaBand.config}
                      locale={personaBand.sourceLocale}
                    />
                  </div>
                  {/* The page's one finder host; the Grow lean button opens it. */}
                  {findLanguage && locale ? (
                    <WatchFindFlowHost
                      languageSlug={findLanguage}
                      locale={locale}
                    />
                  ) : null}
                </div>
                <div
                  data-testid="watch-persona-band"
                  className="relative z-2 w-full bg-black/45"
                >
                  <div
                    className={`flex flex-col items-stretch justify-center gap-6 pt-8 pb-16 ${WATCH_PAGE_CONTENT_CLASSES}`}
                  >
                    {audienceBlock(audienceIdBase)}
                    {personaBand.tail.map(renderBodyEntry)}
                  </div>
                </div>
              </>
            ) : (
              <div
                className={`relative z-2 flex flex-col items-stretch justify-center gap-6 pt-2 pb-16 ${WATCH_PAGE_CONTENT_CLASSES}`}
              >
                {orderedBody.map(renderBodyEntry)}
                {audienceEnabled ? audienceBlock(undefined) : null}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  )
}

function WatchBlockEntry({
  manifest,
  block,
  index,
  downloadButtonLabel,
  downloadError,
  downloadHref,
  downloadPending,
  studyQuestionsBlock,
  modalCallbacks,
  onPlayerReady,
  onPlayerActivated,
  onPlayerViewabilityChange,
  languageSlug,
  locale,
  hasSubtitleOptions,
  subtitleLanguageCode,
  subtitleLanguageTag,
  shareHref,
  subtitleVttSrc,
  hideBibleQuotes,
  pendingChapter,
  coverBlackoutKey,
  coverBlackoutPhase,
  onChapterNavigateIntent,
}: {
  block: MergedWatchBlock
  manifest?: SignedWatchSurfaceManifest
  index: number
  downloadButtonLabel?: string
  downloadError?: string | null
  downloadHref?: string
  downloadPending?: boolean
  studyQuestionsBlock: WatchStudyQuestionsBlock | null
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onPlayerActivated?: (initiation: "manual" | "automatic") => void
  onPlayerViewabilityChange?: (visible: boolean) => void
  languageSlug?: string
  locale?: string
  hasSubtitleOptions: boolean
  subtitleLanguageCode?: string | null
  subtitleLanguageTag?: string | null
  shareHref?: string
  subtitleVttSrc?: string | null
  hideBibleQuotes: boolean
  pendingChapter?: WatchChapterNavigationIntent | null
  coverBlackoutKey?: string | null
  coverBlackoutPhase?: "covering" | "revealing" | null
  onChapterNavigateIntent?: (intent: WatchChapterNavigationIntent) => void
}) {
  if (isWatchBlock(block)) {
    if (block.kind === "SiblingCarousel") {
      return (
        <WatchExposureBoundary
          manifest={manifest}
          config={{
            surface: "watch-video",
            block: "chapters",
            presentation: "carousel",
            placement: `chapters-${index}`,
          }}
        >
          <SyntheticBlock
            block={block}
            studyQuestionsBlock={studyQuestionsBlock}
            languageSlug={languageSlug}
            locale={locale}
            hasSubtitleOptions={hasSubtitleOptions}
            hideBibleQuotes={hideBibleQuotes}
            pendingChapter={pendingChapter}
            onChapterNavigateIntent={onChapterNavigateIntent}
          />
        </WatchExposureBoundary>
      )
    }
    return (
      <SyntheticBlock
        block={block}
        downloadButtonLabel={downloadButtonLabel}
        downloadError={downloadError}
        downloadHref={downloadHref}
        downloadPending={downloadPending}
        studyQuestionsBlock={studyQuestionsBlock}
        modalCallbacks={modalCallbacks}
        onPlayerReady={onPlayerReady}
        onPlayerActivated={onPlayerActivated}
        onPlayerViewabilityChange={onPlayerViewabilityChange}
        languageSlug={languageSlug}
        locale={locale}
        hasSubtitleOptions={hasSubtitleOptions}
        subtitleLanguageCode={subtitleLanguageCode}
        subtitleLanguageTag={subtitleLanguageTag}
        shareHref={shareHref}
        subtitleVttSrc={subtitleVttSrc}
        hideBibleQuotes={hideBibleQuotes}
        pendingChapter={pendingChapter}
        coverBlackoutKey={coverBlackoutKey}
        coverBlackoutPhase={coverBlackoutPhase}
        onChapterNavigateIntent={onChapterNavigateIntent}
      />
    )
  }
  return (
    <WatchExposureBoundary
      manifest={manifest}
      config={{
        surface: "watch-video",
        block: "editorial",
        presentation: "authored-block",
        placement: `editorial-${index}`,
      }}
    >
      <ExperienceSectionRenderer
        section={block}
        key={`strapi-${index}`}
        languageSlug={languageSlug}
      />
    </WatchExposureBoundary>
  )
}

function SyntheticBlock({
  block,
  downloadButtonLabel,
  downloadError,
  downloadHref,
  downloadPending,
  studyQuestionsBlock,
  modalCallbacks,
  onPlayerReady,
  onPlayerActivated,
  onPlayerViewabilityChange,
  languageSlug,
  locale,
  hasSubtitleOptions,
  subtitleLanguageCode,
  subtitleLanguageTag,
  shareHref,
  subtitleVttSrc,
  hideBibleQuotes,
  pendingChapter,
  coverBlackoutKey,
  coverBlackoutPhase,
  onChapterNavigateIntent,
}: {
  block: WatchBlock
  downloadButtonLabel?: string
  downloadError?: string | null
  downloadHref?: string
  downloadPending?: boolean
  studyQuestionsBlock: WatchStudyQuestionsBlock | null
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onPlayerActivated?: (initiation: "manual" | "automatic") => void
  onPlayerViewabilityChange?: (visible: boolean) => void
  languageSlug?: string
  locale?: string
  hasSubtitleOptions: boolean
  subtitleLanguageCode?: string | null
  subtitleLanguageTag?: string | null
  shareHref?: string
  subtitleVttSrc?: string | null
  hideBibleQuotes: boolean
  pendingChapter?: WatchChapterNavigationIntent | null
  coverBlackoutKey?: string | null
  coverBlackoutPhase?: "covering" | "revealing" | null
  onChapterNavigateIntent?: (intent: WatchChapterNavigationIntent) => void
}) {
  const optimisticVisual =
    pendingChapter != null
      ? {
          title: pendingChapter.title,
          label: pendingChapter.label,
          posterUrl: pendingChapter.posterUrl,
          posterBlurDataUrl: pendingChapter.posterBlurDataUrl ?? null,
          loading: true,
          transitionKey: pendingChapter.targetVideoDocumentId,
        }
      : null

  switch (block.kind) {
    case "HeroPlayer": {
      const playableLanguageCount =
        block.playableLanguageCount ??
        (block.video.variants ?? []).filter(isPlayableLanguageVariant).length
      return (
        <HeroPlayer
          block={block}
          onPlayerReady={onPlayerReady}
          onPlayerActivated={onPlayerActivated}
          onPlayerViewabilityChange={onPlayerViewabilityChange}
          onLanguageClick={modalCallbacks?.openLanguage}
          onCancelLanguageOpen={modalCallbacks?.cancelPendingLanguage}
          onShareClick={modalCallbacks?.openShare}
          languageSlug={languageSlug ?? null}
          playableLanguageCount={playableLanguageCount}
          hasSubtitleOptions={hasSubtitleOptions}
          subtitleLanguageCode={subtitleLanguageCode}
          subtitleLanguageTag={subtitleLanguageTag}
          subtitleVttSrc={subtitleVttSrc}
          optimisticVisual={optimisticVisual}
          coverBlackoutKey={coverBlackoutKey}
          coverBlackoutPhase={coverBlackoutPhase}
        />
      )
    }
    case "SiblingCarousel":
      return (
        <SiblingCarousel
          block={block}
          languageSlug={languageSlug ?? ""}
          pendingNavigation={pendingChapter ?? null}
          onChapterNavigateIntent={onChapterNavigateIntent}
        />
      )

    case "WatchBody":
      return (
        <WatchBody
          block={block}
          downloadButtonLabel={downloadButtonLabel}
          downloadError={downloadError}
          downloadHref={downloadHref}
          downloadPending={downloadPending}
          studyQuestions={studyQuestionsBlock}
          onDownloadClick={modalCallbacks?.openDownload ?? noop}
          optimisticTitle={pendingChapter?.title ?? null}
        />
      )
    case "SemanticRecommendations":
      return (
        <WatchSemanticRecommendations
          seedMediaId={block.seedMediaId}
          seedMediaSlug={block.seedMediaSlug}
          locale={locale ?? DEFAULT_LOCALE}
          audioLanguageSlug={languageSlug ?? DEFAULT_WATCH_LANGUAGE_SLUG}
        />
      )
    case "StudyQuestions":
      // Rendered inside <WatchBody>; this marker exists so dispatch tests
      // can still assert the slot was reached.
      return (
        <span
          data-block-type="StudyQuestions"
          data-content={JSON.stringify({
            count: block.studyQuestions.length,
            renderedBy: "WatchBody",
          })}
          hidden
        />
      )
    case "BibleQuotes":
      if (hideBibleQuotes) return null
      return (
        <BibleQuotesSection
          bibleCitations={block.bibleCitations}
          href={shareHref}
          onShareClick={modalCallbacks?.openShare ?? noop}
          passages={block.passages}
        />
      )
    case "Share":
      // Share trigger lives inside <BibleQuotesSection>'s header; this marker
      // preserves the slot so an Experience override can target it independently.
      return (
        <span
          data-block-type="Share"
          data-content={JSON.stringify({
            videoDocumentId: block.video.documentId,
            videoSlug: block.video.slug ?? null,
            renderedBy: "BibleQuotesSection",
          })}
          hidden
        />
      )
    default: {
      const _exhaustive: never = block
      void _exhaustive
      return null
    }
  }
}

function noop() {}

function blockKey(block: MergedWatchBlock, index: number): string {
  if (isWatchBlock(block)) return `${block.kind}-${index}`
  return `strapi-${index}`
}
