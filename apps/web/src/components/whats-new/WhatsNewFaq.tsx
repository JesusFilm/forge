"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { WatchFaqList } from "@/components/watch/WatchFaqList"
import { WHATS_NEW_FAQ } from "@/components/whats-new/whats-new-content"

const ALL_IDS = WHATS_NEW_FAQ.items.map((item) => item.id)
const ITEMS = WHATS_NEW_FAQ.items.map((item) => ({
  id: item.id,
  question: item.question,
  answer: item.answer,
}))

/**
 * The FAQ presentation lives in `WatchFaqList`, shared with the authored
 * Experience FAQ block. This owns the band it sits on, the bulk control, and
 * the multi-open state — every row can be open at once so one button can
 * expand all of them.
 */
export function WhatsNewFaq({ contentClass }: { contentClass: string }) {
  const [open, setOpen] = useState<readonly string[]>([])
  const allOpen = open.length === ALL_IDS.length

  function setRow(id: string, isOpen: boolean) {
    setOpen((current) => {
      const has = current.includes(id)
      // Ignore a toggle that matches what we already believe — `<details>`
      // fires one for React's own writes too, not just the user's.
      if (isOpen === has) return current
      return isOpen ? [...current, id] : current.filter((it) => it !== id)
    })
  }

  return (
    <section
      id="faq"
      aria-labelledby="whats-new-faq-heading"
      data-testid="whats-new-faq"
      /* Light band immediately above the footer — the page lands on paper
         rather than ending on another dark section. A warm off-white rather
         than pure white, so the answers read as a separate shelf from the
         white vote band above it and the white footer below; the hairline
         alone was carrying that separation.

         The `text-[#131111]` here is what every `currentColor`-derived value
         inside `WatchFaqList` resolves against. */
      className="relative border-t border-black/[0.08] bg-[#f8f7f5] text-[#131111] scroll-mt-24 md:scroll-mt-32"
    >
      <div className={`${contentClass} py-16 sm:py-20 lg:py-24`}>
        <WatchFaqList
          items={ITEMS}
          openIds={open}
          onToggle={setRow}
          eyebrow={WHATS_NEW_FAQ.eyebrow}
          heading={WHATS_NEW_FAQ.heading}
          headingId="whats-new-faq-heading"
          itemTestId="whats-new-faq-item"
          questionHoverClass="group-hover/question:text-[#cb333b]"
          headerAction={
            <button
              type="button"
              data-testid="whats-new-faq-toggle-all"
              aria-expanded={allOpen}
              onClick={() => setOpen(allOpen ? [] : ALL_IDS)}
              className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[#cb333b] transition-colors hover:text-[#131111] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111]"
            >
              {allOpen ? WHATS_NEW_FAQ.collapseAll : WHATS_NEW_FAQ.expandAll}
              <ChevronDown
                aria-hidden
                className={`size-4 transition-transform duration-200 ${
                  allOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          }
        />
      </div>
    </section>
  )
}
