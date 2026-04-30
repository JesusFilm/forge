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
  const hasRightColumn = prompts.length > 0

  return (
    <section
      data-block-type="WatchBody"
      data-testid="watch-body"
      data-has-right-column={hasRightColumn ? "true" : "false"}
      className="grid w-full grid-cols-12 gap-10 py-8 text-stone-100 md:grid-cols-12 md:gap-6"
    >
      <div
        data-testid="watch-body-left"
        className={
          hasRightColumn
            ? "col-span-12 flex min-w-0 flex-col gap-4 md:col-span-8"
            : "col-span-12 flex min-w-0 flex-col gap-4 md:col-span-12"
        }
      >
        {video.label ? (
          <span
            data-testid="watch-body-label"
            className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg"
          >
            {video.label}
          </span>
        ) : null}
        <h1
          data-testid="watch-body-title"
          className="text-3xl font-bold text-stone-100 md:text-4xl xl:text-5xl"
        >
          {video.title ?? ""}
        </h1>
        {video.description ? (
          <p
            data-testid="watch-body-description"
            className="text-base leading-relaxed text-stone-200/80 md:text-lg"
          >
            {video.description}
          </p>
        ) : null}
        {hasDownloads ? (
          <div className="pt-2">
            <DownloadButton onClick={onDownloadClick} />
          </div>
        ) : null}
      </div>

      {hasRightColumn ? (
        <div
          data-testid="watch-body-right"
          className="col-span-12 flex min-w-0 flex-col gap-4 md:col-span-4"
        >
          <WatchStudyQuestions
            prompts={prompts}
            onAskYoursClick={onAskYoursClick}
          />
        </div>
      ) : null}
    </section>
  )
}
