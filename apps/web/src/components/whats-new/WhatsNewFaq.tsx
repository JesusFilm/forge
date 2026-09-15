"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

import {
  WatchFaqList,
  WATCH_FAQ_EYEBROW_CLASS,
  WATCH_FAQ_HEADING_CLASS,
} from "@/components/watch/WatchFaqList"
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
export function WhatsNewFaq({
  contentClass,
  aside,
}: {
  contentClass: string
  /**
   * Sidebar beside the questions, from `lg` up. The page passes the
   * "tell us" block in here rather than the component owning it: the FAQ
   * knows how to lay a sidebar out, the page knows what belongs in one,
   * and the feedback button stays where the rest of the page's CTAs are
   * composed.
   *
   * Optional, and the grid collapses to a single column without it, so a
   * caller that wants only questions still gets a sensible layout.
   */
  aside?: ReactNode
}) {
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
      /* Light band immediately above the footer — the page lands on paper
         rather than ending on another dark section. A warm off-white rather
         than pure white, so the answers read as a separate shelf from the
         white vote band above it and the white footer below; the hairline
         alone was carrying that separation. */
      className="relative border-t border-black/[0.08] bg-[#f8f7f5] text-[#131111] scroll-mt-24 md:scroll-mt-32"
    >
      <div className={`${contentClass} py-16 sm:py-20 lg:py-24`}>
        <div className="max-w-2xl">
          <p className={`${WATCH_FAQ_EYEBROW_CLASS} text-[#131111]/55`}>
            {WHATS_NEW_FAQ.eyebrow}
          </p>
          <h2
            id="whats-new-faq-heading"
            className={`mt-4 ${WATCH_FAQ_HEADING_CLASS} text-[#131111]`}
          >
            {WHATS_NEW_FAQ.heading}
          </h2>
        </div>

        {/* Questions left, sidebar right. Below `lg` the sidebar drops
            underneath the questions, which is the reading order in the DOM
            too — the "tell us" block is the thing to do AFTER reading the
            answers, not before.

            The sidebar sticks while the questions scroll past it: the list
            is long enough that a reader who reaches the bottom of it has
            lost the way to tell us anything, which was the whole reason
            this block used to be its own full-width band. */}
        <div className="mt-10 grid gap-12 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:gap-16">
          <div>
            {/* Next to the accordion it drives, not off on its own.

                It used to sit at the far right of a full-width header row,
                which put it above the SIDEBAR rather than above the
                questions — a control floating in its own space, pointing at
                nothing. Right-aligned to the questions column, it reads as
                belonging to the list it opens. */}
            <div className="flex justify-end pb-3">
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

            {/* `#cb333b` rather than the shared underline default: this
                band owns a fixed light paper, so a colour can be measured
                here, and 4.81:1 clears AA. The shared default stays an
                underline for callers whose ground the editor picks. */}
            <WatchFaqList
              items={WHATS_NEW_FAQ.items}
              openIds={open}
              onToggle={setRow}
              itemTestId="whats-new-faq-item"
              questionHoverClass="group-hover/question:text-[#cb333b]"
            />
          </div>

          {aside ? (
            <aside
              data-testid="whats-new-faq-aside"
              className="lg:sticky lg:top-28 lg:self-start"
            >
              {aside}
            </aside>
          ) : null}
        </div>
      </div>
    </section>
  )
}
