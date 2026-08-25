"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { WHATS_NEW_FAQ } from "@/components/whats-new/whats-new-content"

const ALL_IDS = WHATS_NEW_FAQ.items.map((item) => item.id)

/**
 * FAQ built on native `<details>` rather than a custom disclosure.
 *
 * The browser supplies the keyboard behaviour, the expanded/collapsed
 * announcement, and find-in-page expansion for free — and because the
 * markup is native, every question still opens if this component never
 * hydrates. React only controls `open` so that one button can toggle all
 * of them at once.
 */
export function WhatsNewFaq({ contentClass }: { contentClass: string }) {
  const [open, setOpen] = useState<readonly string[]>([])
  const allOpen = open.length === ALL_IDS.length

  function setRow(id: string, isOpen: boolean) {
    setOpen((current) => {
      const has = current.includes(id)
      if (isOpen === has) return current
      return isOpen ? [...current, id] : current.filter((it) => it !== id)
    })
  }

  return (
    <section
      id="faq"
      aria-labelledby="whats-new-faq-heading"
      data-testid="whats-new-faq"
      /* Light band immediately above the footer, which is also white — the
         page lands on paper rather than ending on another dark section. The
         hairline separates it from the vote band, which is white too. */
      className="relative border-t border-black/[0.08] bg-white text-[#131111] scroll-mt-24 md:scroll-mt-32"
    >
      <div className={`${contentClass} py-16 sm:py-20 lg:py-24`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.3em] text-[#131111]/55 uppercase sm:text-sm">
              {WHATS_NEW_FAQ.eyebrow}
            </p>
            <h2
              id="whats-new-faq-heading"
              className="mt-4 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-[#131111] sm:text-4xl lg:text-5xl"
            >
              {WHATS_NEW_FAQ.heading}
            </h2>
          </div>

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
        </div>

        <div className="mt-10 lg:mt-14">
          {WHATS_NEW_FAQ.items.map((item) => (
            <details
              key={item.id}
              open={open.includes(item.id)}
              onToggle={(event) => setRow(item.id, event.currentTarget.open)}
              data-testid="whats-new-faq-item"
              className="group border-t border-black/10 last:border-b"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-8 py-6 text-left transition-colors hover:text-[#cb333b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131111] [&::-webkit-details-marker]:hidden">
                <h3 className="text-lg leading-snug font-semibold text-balance sm:text-xl">
                  {item.question}
                </h3>
                <ChevronDown
                  aria-hidden
                  className="mt-1 size-5 shrink-0 text-[#131111] opacity-45 transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="max-w-3xl pr-8 pb-7 text-base leading-8 text-[#131111]/72">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
