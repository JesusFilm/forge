"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import Markdown from "react-markdown"
import { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import { Button } from "@/components/ui/button"

export { relatedQuestionsFragment }

type RelatedQuestionsProps = {
  data: FragmentOf<typeof relatedQuestionsFragment>
}

/**
 * Decorative `?` icon shown next to each related question. Exported so the
 * watch-page `<WatchStudyQuestions>` can mirror the same visual vocabulary
 * without duplicating SVG paths.
 */
export function QuestionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-1 mr-1.5 size-5 shrink-0 opacity-20"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}

/** Speech-bubble icon used inside the "Ask yours" pill button. */
export function MessageCircleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  )
}

function QuestionItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string
  answer: string
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className="group w-full cursor-pointer rounded-lg py-3 text-left transition-colors hover:bg-white/5"
      >
        <div className="w-full">
          <div className="flex items-start justify-between">
            <p className="flex text-base leading-[1.6] font-semibold text-stone-100 sm:pr-4 md:text-lg md:text-balance">
              <QuestionIcon />
              {question}
            </p>
            <div className="hidden shrink-0 p-2 text-stone-400 transition-colors group-hover:text-white sm:block">
              <svg
                className={`size-6 transform transition-transform ${isOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                />
              </svg>
            </div>
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="border-b border-stone-500/20 py-6 pb-12 text-stone-200/80">
          <Markdown
            components={{
              ul: ({ children }) => (
                <ul className="mt-2 list-disc space-y-2 pl-6">{children}</ul>
              ),
              li: ({ children }) => <li>{children}</li>,
              p: ({ children }) => (
                <p className="leading-relaxed">{children}</p>
              ),
            }}
          >
            {answer}
          </Markdown>
        </div>
      )}
    </>
  )
}

export function RelatedQuestions({ data }: RelatedQuestionsProps) {
  const t = useTranslations("WatchStudyQuestions")
  const { id, sectionKey, heading, questions } = data
  const ctaLabel = String((data as Record<string, unknown>).ctaLabel ?? "")
  const ctaLink = String((data as Record<string, unknown>).ctaLink ?? "")
  // Identify each question by its array index. Admin's
  // `RelatedQuestionItemSchema` (apps/admin/src/domain/blocks.ts) does
  // NOT carry an `id` field on individual items — only `question` +
  // `answer` — so `q.id` is `undefined` for every item. Without an
  // index-based identifier, `openQuestion === q.id` (both undefined)
  // matches every row and clicking one expands all of them.
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const validQuestions =
    questions?.filter(
      (q: LegacyFragmentValue): q is NonNullable<typeof q> => q != null,
    ) ?? []

  if (!validQuestions.length) return null

  const handleToggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx)
  }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="RelatedQuestionsSection"
      className="w-full pt-6 xl:pt-4"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between">
        {heading && (
          <h4 className="flex shrink-0 items-center gap-4 py-4 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
            {heading}
          </h4>
        )}

        {ctaLink && (
          <Button
            variant="pill"
            nativeButton={false}
            aria-label={ctaLabel || t("askYours")}
            render={
              <a href={ctaLink} target="_blank" rel="noopener noreferrer" />
            }
          >
            <MessageCircleIcon />
            <span>{ctaLabel || t("askYours")}</span>
          </Button>
        )}
      </div>

      <div className="relative">
        {validQuestions.map((q: LegacyFragmentValue, idx: number) => (
          <QuestionItem
            key={q.id ?? `q-${idx}`}
            question={q.question ?? ""}
            answer={q.answer ?? ""}
            isOpen={openIndex === idx}
            onToggle={() => handleToggle(idx)}
          />
        ))}
      </div>
    </section>
  )
}
