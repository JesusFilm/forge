"use client"

import type { MuxPlayerRef } from "@forge/video-player"

import {
  type MergedWatchBlock,
  type RouteVideo,
  type WatchBlock,
  type WatchStudyQuestionsBlock,
} from "@/lib/content"
import { isWatchBlock } from "@/lib/watch-blocks"
import { ExperienceSectionRenderer } from "@/components/sections"
import { BibleQuotesSection } from "@/components/watch/BibleQuotesSection"
import { HeroPlayer } from "@/components/watch/HeroPlayer"
import { SiblingCarousel } from "@/components/watch/SiblingCarousel"
import { WatchBody } from "@/components/watch/WatchBody"
import type { WatchModalCallbacks } from "@/components/watch/WatchPageClient"
import type { WatchChapterNavigationIntent } from "@/components/watch/chapter-navigation"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"

// Typo guard: literal-union typing fails the type check on misspellings.
//
// `HeroPlayer` is the only top-zone block — it's the sticky cinematic player
// that pins to the viewport while body content slides over it. The
// `SiblingCarousel` was originally part of this zone too, but rendering it
// alongside the sticky hero meant the carousel would scroll over and visually
// "cover" the hero during scroll. Demoting the carousel into the body zone
// keeps it directly below the hero in normal flow, with the rest of the body
// content (WatchBody, StudyQuestions, BibleQuotes, Share) following it.
const TOP_ZONE_KINDS: Set<WatchBlock["kind"]> = new Set(["HeroPlayer"])

export function WatchSectionRenderer({
  blocks,
  downloadButtonLabel,
  downloadError,
  downloadHref,
  downloadPending,
  modalCallbacks,
  onPlayerReady,
  onPlayerActivated,
  languageSlug,
  hasSubtitleOptions = false,
  subtitleLanguageCode,
  shareHref,
  subtitleVttSrc,
  hideBibleQuotes = false,
  pendingChapter,
  coverBlackoutKey,
  coverBlackoutPhase,
  onChapterNavigateIntent,
  routeVideo,
}: {
  blocks: MergedWatchBlock[]
  downloadButtonLabel?: string
  downloadError?: string | null
  downloadHref?: string
  downloadPending?: boolean
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onPlayerActivated?: () => void
  languageSlug?: string
  hasSubtitleOptions?: boolean
  subtitleLanguageCode?: string | null
  shareHref?: string
  subtitleVttSrc?: string | null
  hideBibleQuotes?: boolean
  pendingChapter?: WatchChapterNavigationIntent | null
  coverBlackoutKey?: string | null
  coverBlackoutPhase?: "covering" | "revealing" | null
  onChapterNavigateIntent?: (intent: WatchChapterNavigationIntent) => void
  routeVideo?: RouteVideo | null
}) {
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

  return (
    <>
      {topBlocks.map((block, index) => (
        <WatchBlockEntry
          key={blockKey(block, index)}
          block={block}
          index={index}
          downloadButtonLabel={downloadButtonLabel}
          downloadError={downloadError}
          downloadHref={downloadHref}
          downloadPending={downloadPending}
          studyQuestionsBlock={studyQuestionsBlock}
          modalCallbacks={modalCallbacks}
          onPlayerReady={onPlayerReady}
          onPlayerActivated={onPlayerActivated}
          languageSlug={languageSlug}
          hasSubtitleOptions={hasSubtitleOptions}
          subtitleLanguageCode={subtitleLanguageCode}
          shareHref={shareHref}
          subtitleVttSrc={subtitleVttSrc}
          hideBibleQuotes={hideBibleQuotes}
          pendingChapter={pendingChapter}
          coverBlackoutKey={coverBlackoutKey}
          coverBlackoutPhase={coverBlackoutPhase}
          onChapterNavigateIntent={onChapterNavigateIntent}
          routeVideo={routeVideo}
        />
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
            <div
              className={`relative z-2 flex flex-col items-stretch justify-center gap-6 pt-2 pb-16 ${WATCH_PAGE_CONTENT_CLASSES}`}
            >
              {bodyBlocks.map((block, index) => (
                <WatchBlockEntry
                  key={blockKey(block, index + topBlocks.length)}
                  block={block}
                  index={index + topBlocks.length}
                  downloadButtonLabel={downloadButtonLabel}
                  downloadError={downloadError}
                  downloadHref={downloadHref}
                  downloadPending={downloadPending}
                  studyQuestionsBlock={studyQuestionsBlock}
                  modalCallbacks={modalCallbacks}
                  onPlayerReady={onPlayerReady}
                  onPlayerActivated={onPlayerActivated}
                  languageSlug={languageSlug}
                  hasSubtitleOptions={hasSubtitleOptions}
                  subtitleLanguageCode={subtitleLanguageCode}
                  shareHref={shareHref}
                  hideBibleQuotes={hideBibleQuotes}
                  pendingChapter={pendingChapter}
                  coverBlackoutKey={coverBlackoutKey}
                  coverBlackoutPhase={coverBlackoutPhase}
                  onChapterNavigateIntent={onChapterNavigateIntent}
                  routeVideo={routeVideo}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

function WatchBlockEntry({
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
  languageSlug,
  hasSubtitleOptions,
  subtitleLanguageCode,
  shareHref,
  subtitleVttSrc,
  hideBibleQuotes,
  pendingChapter,
  coverBlackoutKey,
  coverBlackoutPhase,
  onChapterNavigateIntent,
  routeVideo,
}: {
  block: MergedWatchBlock
  index: number
  downloadButtonLabel?: string
  downloadError?: string | null
  downloadHref?: string
  downloadPending?: boolean
  studyQuestionsBlock: WatchStudyQuestionsBlock | null
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onPlayerActivated?: () => void
  languageSlug?: string
  hasSubtitleOptions: boolean
  subtitleLanguageCode?: string | null
  shareHref?: string
  subtitleVttSrc?: string | null
  hideBibleQuotes: boolean
  pendingChapter?: WatchChapterNavigationIntent | null
  coverBlackoutKey?: string | null
  coverBlackoutPhase?: "covering" | "revealing" | null
  onChapterNavigateIntent?: (intent: WatchChapterNavigationIntent) => void
  routeVideo?: RouteVideo | null
}) {
  if (isWatchBlock(block)) {
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
        languageSlug={languageSlug}
        hasSubtitleOptions={hasSubtitleOptions}
        subtitleLanguageCode={subtitleLanguageCode}
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
    <ExperienceSectionRenderer
      section={block}
      key={`strapi-${index}`}
      languageSlug={languageSlug}
      routeVideo={routeVideo}
    />
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
  languageSlug,
  hasSubtitleOptions,
  subtitleLanguageCode,
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
  onPlayerActivated?: () => void
  languageSlug?: string
  hasSubtitleOptions: boolean
  subtitleLanguageCode?: string | null
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
          onLanguageClick={modalCallbacks?.openLanguage}
          onShareClick={modalCallbacks?.openShare}
          languageSlug={languageSlug ?? null}
          playableLanguageCount={playableLanguageCount}
          hasSubtitleOptions={hasSubtitleOptions}
          subtitleLanguageCode={subtitleLanguageCode}
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
