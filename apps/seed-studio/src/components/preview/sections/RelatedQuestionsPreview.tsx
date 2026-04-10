"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import type { RelatedQuestionsSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type RelatedQuestionsPreviewProps = {
  section: RelatedQuestionsSection
}

export function RelatedQuestionsPreview({
  section,
}: RelatedQuestionsPreviewProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-neutral-900">
        {section.heading}
      </h4>
      <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {section.questions.map((item, i) => {
          const isExpanded = expandedIndex === i
          return (
            <button
              key={i}
              type="button"
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              className="w-full text-left"
            >
              <div
                className={cn(
                  "flex items-start gap-2 px-3 py-2.5",
                  "transition-colors hover:bg-neutral-50",
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                )}
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-neutral-800">
                    {item.question}
                  </p>
                  {isExpanded ? (
                    <p className="text-sm leading-relaxed text-neutral-600">
                      {item.answer}
                    </p>
                  ) : null}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
