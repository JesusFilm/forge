"use client"

import {
  MessageCircleIcon,
  QuestionIcon,
} from "@/components/sections/RelatedQuestions"
import { Button } from "@/components/ui/button"

// Prompts are intentionally non-interactive: Video.studyQuestions has no
// `answer` field, so any chevron/expand affordance would be a false promise.
// Tests in WatchBody.test.tsx pin this contract.
export function WatchStudyQuestions({
  prompts,
  onAskYoursClick,
}: {
  prompts: string[]
  onAskYoursClick: () => void
}) {
  return (
    <section
      data-testid="watch-study-questions"
      aria-labelledby="watch-related-questions-heading"
      className="w-full pt-6 xl:pt-4"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between">
        <h4
          id="watch-related-questions-heading"
          className="flex shrink-0 items-center gap-4 py-4 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg"
        >
          Related Questions
        </h4>
        <Button
          variant="pill"
          aria-label="Ask yours"
          data-testid="watch-study-questions-ask-yours"
          onClick={onAskYoursClick}
        >
          <MessageCircleIcon />
          <span>Ask yours</span>
        </Button>
      </div>

      <ul
        data-testid="watch-study-questions-list"
        className="relative flex flex-col"
      >
        {prompts.map((prompt, index) => (
          <li
            key={`${index}-${prompt}`}
            data-testid="watch-study-questions-item"
            className="border-b border-stone-500/20 py-3"
          >
            <p className="flex text-base leading-[1.6] font-semibold text-stone-100 sm:pr-4 md:text-lg md:text-balance">
              <QuestionIcon />
              {prompt}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
