"use client"

import { useState } from "react"
import type { FragmentOf } from "@forge/graphql"
import Markdown from "react-markdown"
import { relatedQuestionsFragment } from "@/lib/fragments/related-questions"

export { relatedQuestionsFragment }

type RelatedQuestionsProps = {
  data: FragmentOf<typeof relatedQuestionsFragment>
}

function QuestionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 size-5 shrink-0 opacity-20"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
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
        className="group w-full cursor-pointer rounded-lg px-4 py-3 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-start justify-between">
          <p className="flex gap-3 text-base leading-[1.6] font-semibold text-stone-100 sm:pr-4 md:text-lg md:text-balance">
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
      </button>

      {isOpen && (
        <div className="border-b border-stone-500/20 px-4 py-6 pb-12 text-stone-200/80">
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
  const { id, sectionKey, heading, questions } = data
  const [openQuestion, setOpenQuestion] = useState<string | null>(null)

  const validQuestions =
    questions?.filter((q): q is NonNullable<typeof q> => q != null) ?? []

  if (!validQuestions.length) return null

  const handleToggle = (qId: string) => {
    setOpenQuestion(openQuestion === qId ? null : qId)
  }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="RelatedQuestionsSection"
      className="w-full"
    >
      {heading && (
        <h4 className="mb-6 flex items-center gap-4 py-4 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
          {heading}
        </h4>
      )}
      <div className="relative">
        {validQuestions.map((q) => (
          <QuestionItem
            key={q.id}
            question={q.question ?? ""}
            answer={q.answer ?? ""}
            isOpen={openQuestion === q.id}
            onToggle={() => handleToggle(q.id)}
          />
        ))}
      </div>
    </section>
  )
}
