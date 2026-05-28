"use client"

import { DownloadButton } from "@/components/watch/DownloadButton"
import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"
import type { WatchBodyBlock, WatchStudyQuestionsBlock } from "@/lib/content"

export function WatchBody({
  block,
  downloadButtonLabel,
  studyQuestions,
  onDownloadClick,
}: {
  block: WatchBodyBlock
  downloadButtonLabel?: string
  studyQuestions: WatchStudyQuestionsBlock | null
  onDownloadClick: () => void
}) {
  const { video, variant } = block
  const hasDownloads = (variant.downloads ?? []).length > 0
  const prompts = (studyQuestions?.studyQuestions ?? [])
    .map((q) => q.value)
    .filter((v): v is string => v != null && v.length > 0)

  // The right column (Related Questions + Ask Yours CTA) always renders.
  // When there are no editorial prompts, WatchStudyQuestions falls back to
  // a single placeholder row -- the Ask Yours flow is always relevant, so
  // hiding the section was leaving the CTA stranded on prompt-less videos.
  return (
    <section
      data-block-type="WatchBody"
      data-testid="watch-body"
      className="grid w-full grid-cols-1 gap-10 py-8 text-stone-100 md:grid-cols-12 md:gap-12 xl:gap-16 2xl:gap-20"
    >
      <div
        data-testid="watch-body-left"
        className="col-span-1 flex min-w-0 flex-col gap-4 md:col-span-7"
      >
        {/* Keep Download grouped with the title, but stack it below the title on
            mobile so the title can use the full content rail. */}
        <div
          data-testid="watch-body-title-row"
          className="flex flex-col items-start gap-3 md:flex-row md:justify-between md:gap-4"
        >
          {/* The HeroPlayer overlay already renders the canonical <h1> for
              this video. The body title repeats that text for visual
              hierarchy in the body section, so it ships as <h2> to keep
              one <h1> per page (WCAG 1.3.1). Visual styling is unchanged. */}
          <h2
            data-testid="watch-body-title"
            className="min-w-0 text-3xl font-bold text-stone-100 md:text-4xl xl:text-5xl"
          >
            {video.title ?? ""}
          </h2>
          {hasDownloads ? (
            <div className="shrink-0">
              <DownloadButton
                label={downloadButtonLabel}
                onClick={onDownloadClick}
              />
            </div>
          ) : null}
        </div>
        {video.description ? (
          <p
            data-testid="watch-body-description"
            className="text-base leading-relaxed text-stone-200/80 md:mt-6 md:text-lg"
          >
            {video.description}
          </p>
        ) : null}
      </div>

      <div
        data-testid="watch-body-right"
        className="col-span-1 flex min-w-0 flex-col gap-4 md:col-span-5"
      >
        <WatchStudyQuestions prompts={prompts} />
      </div>
    </section>
  )
}
