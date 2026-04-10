import { BookOpen } from "lucide-react"

import type { BibleQuotesCarouselSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type BibleQuotesPreviewProps = {
  section: BibleQuotesCarouselSection
}

export function BibleQuotesPreview({ section }: BibleQuotesPreviewProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-neutral-900">
        {section.heading}
      </h4>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {section.quotes.map((quote, i) => (
          <div
            key={i}
            className={cn(
              "w-56 shrink-0 space-y-2 rounded-lg p-4",
              "border border-neutral-200",
            )}
            style={{
              backgroundColor: quote.backgroundColor || undefined,
            }}
          >
            <BookOpen className="h-4 w-4 text-primary-500" />
            <p className="text-sm italic leading-relaxed text-neutral-800">
              &ldquo;{quote.text}&rdquo;
            </p>
            <p className="text-xs font-semibold text-primary-700">
              {quote.reference}
            </p>
            {quote.attribution ? (
              <p className="text-xs text-neutral-500">{quote.attribution}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
