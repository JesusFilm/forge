"use client"

import { DownloadButton } from "@/components/watch/DownloadButton"
import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"
import type { WatchBodyBlock, WatchStudyQuestionsBlock } from "@/lib/content"

export function WatchBody({
  block,
  downloadButtonLabel,
  downloadError,
  downloadHref,
  downloadPending = false,
  studyQuestions,
  onDownloadClick,
  optimisticTitle,
}: {
  block: WatchBodyBlock
  downloadButtonLabel?: string
  downloadError?: string | null
  downloadHref?: string
  downloadPending?: boolean
  studyQuestions: WatchStudyQuestionsBlock | null
  onDownloadClick: () => void
  optimisticTitle?: string | null
}) {
  const { video, variant } = block
  const visualTitle = optimisticTitle ?? video.title ?? ""
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
        {/* Keep Download beside and top-aligned with the title by default so
            both column actions share one visual row. On landscape phones,
            stack the CTA below so long localized titles can use the full
            column width and the action stays anchored to its heading. */}
        <div
          data-testid="watch-body-title-row"
          className="flex flex-nowrap items-start justify-between gap-3 [@media(max-width:1023px)_and_(orientation:landscape)]:flex-col"
        >
          {/* The HeroPlayer overlay already renders the canonical <h1> for
              this video. The body title repeats that text for visual
              hierarchy in the body section, so it ships as <h2> to keep
              one <h1> per page (WCAG 1.3.1). Visual styling is unchanged. */}
          <h2
            data-testid="watch-body-title"
            className="min-w-0 flex-1 text-[27px] leading-[1.08] font-semibold text-stone-100 [@media(max-width:1023px)_and_(orientation:landscape)]:w-full md:text-4xl xl:text-5xl"
          >
            {visualTitle}
          </h2>
          {hasDownloads ? (
            <div
              data-testid="watch-download-group"
              className="ml-auto flex shrink-0 flex-col items-end gap-2 [@media(max-width:1023px)_and_(orientation:landscape)]:ml-0 [@media(max-width:1023px)_and_(orientation:landscape)]:items-start"
            >
              <DownloadButton
                href={downloadHref}
                label={downloadButtonLabel}
                onClick={onDownloadClick}
                pending={downloadPending}
              />
              {downloadError ? (
                <p
                  className="max-w-64 text-sm leading-snug font-semibold text-red-200"
                  data-testid="watch-download-error"
                  role="alert"
                >
                  {downloadError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {video.description ? (
          <p
            data-testid="watch-body-description"
            className="text-base leading-relaxed font-normal text-stone-200/80 md:mt-6 md:text-lg"
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
