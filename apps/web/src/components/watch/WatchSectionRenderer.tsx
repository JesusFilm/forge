"use client"

import type { MuxPlayerRef } from "@forge/video-player"

import {
  isWatchBlock,
  type MergedWatchBlock,
  type WatchBlock,
  type WatchStudyQuestionsBlock,
} from "@/lib/content"
import { ExperienceSectionRenderer } from "@/components/sections"
import { BibleQuotesSection } from "@/components/watch/BibleQuotesSection"
import { HeroPlayer } from "@/components/watch/HeroPlayer"
// `SiblingCarousel` import skipped — dispatch case below returns null until
// thumbnail-image plumbing is restored.
import { WatchBody } from "@/components/watch/WatchBody"
import type { WatchModalCallbacks } from "@/components/watch/WatchPageClient"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"

// Typo guard: literal-union typing fails the type check on misspellings.
const TOP_ZONE_KINDS: Set<WatchBlock["kind"]> = new Set([
  "HeroPlayer",
  "SiblingCarousel",
])

export function WatchSectionRenderer({
  blocks,
  modalCallbacks,
  onPlayerReady,
}: {
  blocks: MergedWatchBlock[]
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
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
          studyQuestionsBlock={studyQuestionsBlock}
          modalCallbacks={modalCallbacks}
          onPlayerReady={onPlayerReady}
        />
      ))}
      {bodyBlocks.length > 0 ? (
        <section
          data-testid="watch-body-zone"
          className="relative w-full text-white"
        >
          <div
            className="relative mx-auto w-full overflow-hidden bg-stone-800 backdrop-blur-2xl md:max-w-[1920px]"
            style={{
              backgroundColor: "rgb(var(--color-section-default) / 0.65)",
            }}
          >
            <div
              className="absolute inset-0 z-1 bg-repeat mix-blend-multiply"
              style={{ backgroundImage: 'url("/watch/images/overlay.svg")' }}
              aria-hidden="true"
            />
            <div
              className={`relative z-2 flex flex-col items-stretch justify-center gap-10 py-10 pb-16 ${CONTENT_WIDTH_CLASSES}`}
            >
              {bodyBlocks.map((block, index) => (
                <WatchBlockEntry
                  key={blockKey(block, index + topBlocks.length)}
                  block={block}
                  index={index + topBlocks.length}
                  studyQuestionsBlock={studyQuestionsBlock}
                  modalCallbacks={modalCallbacks}
                  onPlayerReady={onPlayerReady}
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
  studyQuestionsBlock,
  modalCallbacks,
  onPlayerReady,
}: {
  block: MergedWatchBlock
  index: number
  studyQuestionsBlock: WatchStudyQuestionsBlock | null
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
}) {
  if (isWatchBlock(block)) {
    return (
      <SyntheticBlock
        block={block}
        studyQuestionsBlock={studyQuestionsBlock}
        modalCallbacks={modalCallbacks}
        onPlayerReady={onPlayerReady}
      />
    )
  }
  return <ExperienceSectionRenderer section={block} key={`strapi-${index}`} />
}

function SyntheticBlock({
  block,
  studyQuestionsBlock,
  modalCallbacks,
  onPlayerReady,
}: {
  block: WatchBlock
  studyQuestionsBlock: WatchStudyQuestionsBlock | null
  modalCallbacks?: WatchModalCallbacks
  onPlayerReady?: (player: MuxPlayerRef | null) => void
}) {
  switch (block.kind) {
    case "HeroPlayer":
      return <HeroPlayer block={block} onPlayerReady={onPlayerReady} />
    case "SiblingCarousel":
      // Hidden until thumbnail-image plumbing is restored. Single-line revert.
      return null
    case "WatchBody":
      return (
        <WatchBody
          block={block}
          studyQuestions={studyQuestionsBlock}
          onDownloadClick={modalCallbacks?.openDownload ?? noop}
          onAskYoursClick={modalCallbacks?.openAskYours ?? noop}
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
      return (
        <BibleQuotesSection
          bibleCitations={block.bibleCitations}
          onShareClick={modalCallbacks?.openShare ?? noop}
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
