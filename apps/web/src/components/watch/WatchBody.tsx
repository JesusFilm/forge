"use client"

import { DownloadButton } from "@/components/watch/DownloadButton"
import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"
import type { WatchBodyBlock, WatchStudyQuestionsBlock } from "@/lib/content"

export function WatchBody({
  block,
  studyQuestions,
  onDownloadClick,
  onAskYoursClick,
}: {
  block: WatchBodyBlock
  studyQuestions: WatchStudyQuestionsBlock | null
  onDownloadClick: () => void
  onAskYoursClick: () => void
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
      className="grid w-full grid-cols-12 gap-10 py-8 text-stone-100 md:grid-cols-12 md:gap-6"
    >
      <div
        data-testid="watch-body-left"
        className="col-span-12 flex min-w-0 flex-col gap-4 md:col-span-8"
      >
        {video.label ? (
          <span
            data-testid="watch-body-label"
            className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg"
          >
            {video.label}
          </span>
        ) : null}
        {/* Download lives in the title row so its Y axis matches the h1
            (and, by symmetry, the Related Questions / Ask Yours row in the
            right column whose pt is tuned to match this same Y). With
            Download here instead of above the SEGMENT label, increasing pt
            on a sibling can no longer push Download out of alignment. */}
        <div
          data-testid="watch-body-title-row"
          className="flex items-center justify-between gap-4"
        >
          <h1
            data-testid="watch-body-title"
            className="min-w-0 text-3xl font-bold text-stone-100 md:text-4xl xl:text-5xl"
          >
            {video.title ?? ""}
          </h1>
          {hasDownloads ? (
            <div className="shrink-0">
              <DownloadButton onClick={onDownloadClick} />
            </div>
          ) : null}
        </div>
        {video.description ? (
          <p
            data-testid="watch-body-description"
            className="text-base leading-relaxed text-stone-200/80 md:text-lg"
          >
            {video.description}
          </p>
        ) : null}
      </div>

      <div
        data-testid="watch-body-right"
        className="col-span-12 flex min-w-0 flex-col gap-4 md:col-span-4"
      >
        <WatchStudyQuestions
          prompts={prompts}
          onAskYoursClick={onAskYoursClick}
        />
      </div>
    </section>
  )
}
