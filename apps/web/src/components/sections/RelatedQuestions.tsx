"use client"

import type { FragmentOf } from "@forge/graphql"
import Markdown from "react-markdown"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { relatedQuestionsFragment } from "@/lib/fragments/related-questions"

export { relatedQuestionsFragment }

type RelatedQuestionsProps = {
  data: FragmentOf<typeof relatedQuestionsFragment>
}

export function RelatedQuestions({ data }: RelatedQuestionsProps) {
  const { id, sectionKey, heading, questions } = data
  const validQuestions =
    questions?.filter((q): q is NonNullable<typeof q> => q != null) ?? []

  if (!validQuestions.length) return null

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="RelatedQuestionsSection"
      className="w-full"
    >
      {heading && (
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-stone-400 uppercase">
          {heading}
        </h3>
      )}
      <Accordion className="w-full">
        {validQuestions.map((q) => (
          <AccordionItem
            key={q.id}
            className="border-stone-700/40 not-last:border-b"
          >
            <AccordionTrigger className="py-4 text-base font-semibold text-stone-100 hover:text-white hover:no-underline [&>svg]:text-stone-400">
              {q.question}
            </AccordionTrigger>
            <AccordionContent className="text-stone-300">
              <Markdown
                components={{
                  ul: ({ children }) => (
                    <ul className="mt-2 list-disc space-y-1.5 pl-6">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => (
                    <li className="text-stone-300">{children}</li>
                  ),
                  p: ({ children }) => (
                    <p className="leading-relaxed">{children}</p>
                  ),
                }}
              >
                {q.answer ?? ""}
              </Markdown>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
