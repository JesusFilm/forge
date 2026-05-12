"use client"

// Each prompt row is expandable. The forge `Video.studyQuestions` projection
// carries only the question text — no answer field — so the expanded body
// renders the same "no-answer" fallback the legacy core/apps/watch app shows
// for every question: a "Have a private discussion…" line plus two pill CTAs
// pointing at the public Chat / Ask-a-Bible-question endpoints. The
// placeholder row shown when there are no editorial prompts uses the same
// fallback. Mirrors core/apps/watch's DiscussionQuestions/Question.tsx.

import { useId, useState } from "react"
import { Mail as MailIcon } from "lucide-react"

import {
  MessageCircleIcon,
  QuestionIcon,
} from "@/components/sections/RelatedQuestions"
import { Button } from "@/components/ui/button"

const PLACEHOLDER_QUESTION =
  "If you could ask the creator of this video a question, what would it be?"

const FALLBACK_BODY =
  "Have a private discussion with someone who is ready to listen."

const CHAT_WITH_PERSON_URL =
  "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch"
const ASK_BIBLE_QUESTION_URL =
  "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch"
const ASK_YOURS_URL = "https://issuesiface.com/talk?utm_source=jesusfilm-watch"

export function WatchStudyQuestions({ prompts }: { prompts: string[] }) {
  const hasPrompts = prompts.length > 0
  const items = hasPrompts ? prompts : [PLACEHOLDER_QUESTION]
  const itemTestId = hasPrompts
    ? "watch-study-questions-item"
    : "watch-study-questions-placeholder"
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Reset the open row whenever the prompts reference changes (e.g., when
  // the user navigates to a sibling video and the same component instance
  // receives a new prompts array). Using React's "adjusting state in
  // render" pattern — explicitly supported and safer than a useEffect
  // because it avoids the brief frame where a stale index points at the
  // wrong question's panel.
  const [prevPrompts, setPrevPrompts] = useState(prompts)
  if (prevPrompts !== prompts) {
    setPrevPrompts(prompts)
    setOpenIndex(null)
  }

  return (
    <section
      data-testid="watch-study-questions"
      aria-labelledby="watch-related-questions-heading"
      className="w-full pt-0 md:pt-9 xl:pt-11"
    >
      {/* Section pt is tuned so the header (Related Questions + Ask Yours)
          lands on the same Y axis as the h1 title in the left column --
          which now hosts the Download pill in its flex row. The mb below
          the header is sized so the first prompt / placeholder row lines
          up with the start of the video description, keeping the two
          columns visually parallel. */}
      <div className="mb-4 flex flex-wrap items-center justify-between">
        <h4
          id="watch-related-questions-heading"
          className="flex shrink-0 items-center gap-4 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg"
        >
          Related Questions
        </h4>
        <Button
          variant="pill"
          nativeButton={false}
          aria-label="Ask yours"
          data-testid="watch-study-questions-ask-yours"
          render={
            <a href={ASK_YOURS_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <MessageCircleIcon />
          <span>Ask yours</span>
        </Button>
      </div>

      <ul
        data-testid="watch-study-questions-list"
        className="relative flex flex-col"
      >
        {items.map((prompt, index) => (
          <StudyQuestionRow
            key={`${index}-${prompt}`}
            testId={itemTestId}
            question={prompt}
            isOpen={openIndex === index}
            onToggle={() =>
              setOpenIndex((prev) => (prev === index ? null : index))
            }
          />
        ))}
      </ul>
    </section>
  )
}

function StudyQuestionRow({
  testId,
  question,
  isOpen,
  onToggle,
}: {
  testId: string
  question: string
  isOpen: boolean
  onToggle: () => void
}) {
  const panelId = `${useId()}-panel`
  return (
    <li data-testid={testId} className="border-b border-stone-500/20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        data-testid={`${testId}-trigger`}
        className="group flex w-full cursor-pointer items-start justify-between rounded-lg px-4 py-3 text-left transition-colors hover:bg-white/5"
      >
        <p className="flex text-base leading-[1.6] font-semibold text-stone-100 sm:pr-4 md:text-lg md:text-balance">
          <QuestionIcon />
          {question}
        </p>
        <span className="hidden shrink-0 p-2 text-stone-400 transition-colors group-hover:text-white sm:block">
          <svg
            className={`size-6 transform transition-transform ${isOpen ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
            />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div
          id={panelId}
          data-testid={`${testId}-panel`}
          className="pt-2 pr-2 pb-6 pl-8 sm:pl-10"
        >
          <p
            data-testid={`${testId}-fallback-body`}
            className="leading-relaxed text-stone-200/80"
          >
            {FALLBACK_BODY}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="pill"
              nativeButton={false}
              data-testid="watch-study-questions-chat-cta"
              render={
                <a
                  href={CHAT_WITH_PERSON_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <MessageCircleIcon />
              <span>Chat with a person</span>
            </Button>
            <Button
              variant="pill"
              nativeButton={false}
              data-testid="watch-study-questions-ask-bible-cta"
              render={
                <a
                  href={ASK_BIBLE_QUESTION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <MailIcon className="size-4" aria-hidden="true" />
              <span>Ask a Bible question</span>
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
