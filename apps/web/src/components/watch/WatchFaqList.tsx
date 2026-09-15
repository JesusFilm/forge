"use client"

import { useId } from "react"
import type { MouseEvent, ReactNode } from "react"
import { ChevronDown } from "lucide-react"

/**
 * The one FAQ presentation shared by the Watch surfaces: the "what's new"
 * page (`components/whats-new/WhatsNewFaq.tsx`) and the authored Experience
 * FAQ block (`components/sections/RelatedQuestions.tsx`).
 *
 * The two used to be independent components that happened to look alike, so
 * every rhythm value — row padding, hairline weight, question type scale,
 * answer measure — was a duplicated literal that could drift silently. They
 * now render this.
 *
 * ## What this owns, and what the caller keeps
 *
 * This owns the FAQ: the header row's layout, the eyebrow/heading type scale,
 * and the disclosure rows. The caller keeps its own `<section>` — the band or
 * background, the vertical padding, the anchor id, and crucially the *ink*,
 * because the two surfaces sit on different ground. The what's-new FAQ owns a
 * fixed light band (`bg-[#f8f7f5]` / `text-[#131111]`); the Experience block
 * is dropped into a `Section` whose background the editor picks
 * (`SECTION_BG_CLASSES` in `sections/Section.tsx` spans `stone-100` through
 * `stone-900`). So every colour below is derived from the inherited text
 * colour — `currentColor` hairlines, `opacity-*` for the quieter tiers —
 * which holds the same contrast relationships on either.
 *
 * `questionHoverClass` is the one colour that cannot be derived that way: the
 * question's hover red is a brand choice, not a tint of the surrounding ink.
 *
 * ## Controlled, deliberately
 *
 * `<details>` is load-bearing — it supplies keyboard behaviour, the
 * expanded-state announcement, find-in-page expansion, and it still opens if
 * the page never hydrates. But the browser also toggles `open` on its own, so
 * `onToggle` fires for *every* state change including ones React itself
 * caused. Callers own the open-set and must be idempotent: `WhatsNewFaq`
 * keeps a multi-open set with a bulk control, `RelatedQuestions` keeps a
 * single-open accordion. Both ignore a toggle that matches what they already
 * believe, which is what stops the echo from a row React just closed.
 */

/**
 * Chrome fires a click when a drag-select ends inside a `<summary>`, and
 * summary activation is that click's default action — so a visitor copying a
 * question would collapse the row under their cursor. Cancelling the default
 * is the whole fix: no state, no `stopPropagation`, and a plain click still
 * toggles. Trap 2 in
 * `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md`.
 */
function cancelToggleWhileSelecting(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) event.preventDefault()
}

export type WatchFaqItem = {
  /** Stable identity for the open-set. Index-derived is fine. */
  id: string
  question: string
  /**
   * Rendered inside a block with the answer typography. A `ReactNode` rather
   * than a string so the Experience block can hand over its `<Markdown>`
   * subtree; a bare string renders identically.
   */
  answer: ReactNode
}

type WatchFaqListProps = {
  items: readonly WatchFaqItem[]
  /** Ids currently open. */
  openIds: readonly string[]
  /** Fires on every `<details>` state change, browser- or React-initiated. */
  onToggle: (id: string, open: boolean) => void
  eyebrow?: ReactNode
  heading?: ReactNode
  /** Needed when the caller's `<section>` points `aria-labelledby` at it. */
  headingId?: string
  /** Sits at the far end of the header row — a bulk control, a CTA, anything. */
  headerAction?: ReactNode
  /** Stamped on each `<details>`, so each surface keeps its own selector. */
  itemTestId?: string
  /**
   * The question's hover affordance.
   *
   * Defaults to an underline, not a colour. A colour here cannot be derived
   * from the surrounding ink, and no single fixed red clears WCAG AA on both
   * a light and a dark band — measured across all six `SECTION_BG_CLASSES`
   * grounds, the repo's `--color-brand-red` lands between 2.58:1 and 4.35:1
   * against 20px/600 text, which is normal text at that weight. An underline
   * inherits the question's own colour, so it passes wherever the question
   * does. A caller that owns a fixed band may opt into a colour it has
   * measured, as `WhatsNewFaq` does (`#cb333b`, 4.81:1 on its own paper).
   *
   * Must be written as a `group-hover/question:` variant. Hovering anywhere on
   * the row should redden the question, but the chevron beside it has to stay
   * neutral, so the colour lands on the heading rather than on the row that
   * owns the hover. Tailwind only sees class names it can read literally in
   * source, so the whole variant has to arrive from the caller.
   */
  questionHoverClass?: string
}

export function WatchFaqList({
  items,
  openIds,
  onToggle,
  eyebrow,
  heading,
  headingId,
  headerAction,
  itemTestId,
  questionHoverClass = "group-hover/question:underline",
}: WatchFaqListProps) {
  // `<details>` supplies expanded state natively but has no `aria-controls`
  // equivalent, so the trigger-to-panel relationship feat-317 shipped for
  // FGE-40 is restored explicitly. One base per component instance keeps two
  // lists on the same page from colliding.
  const panelIdBase = useId()
  // Set rather than `openIds.includes` per row: the multi-open caller can
  // hold every id at once, which makes the scan quadratic in the row count.
  const openSet = new Set(openIds)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        {(eyebrow || heading) && (
          <div className="max-w-2xl">
            {eyebrow && (
              <p className="text-xs font-semibold tracking-[0.3em] uppercase opacity-55 sm:text-sm">
                {eyebrow}
              </p>
            )}
            {heading && (
              <h2
                id={headingId}
                className={`text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-4xl lg:text-5xl ${
                  eyebrow ? "mt-4" : ""
                }`}
              >
                {heading}
              </h2>
            )}
          </div>
        )}

        {headerAction}
      </div>

      <div className="mt-10 lg:mt-14">
        {items.map((item, index) => {
          const panelId = `${panelIdBase}-${index}`

          return (
            <details
              key={item.id}
              open={openSet.has(item.id)}
              onToggle={(event) => onToggle(item.id, event.currentTarget.open)}
              data-testid={itemTestId}
              className="group border-t border-current/10 last:border-b"
            >
              {/* Two groups, deliberately. The unnamed one is the `<details>`,
                which is what `group-open:` reads to spin the chevron; the
                named one is the row's hover target, scoped so the colour can
                land on the heading alone. */}
              <summary
                aria-controls={panelId}
                onClick={cancelToggleWhileSelecting}
                className="group/question flex cursor-pointer list-none items-start justify-between gap-8 py-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current [&::-webkit-details-marker]:hidden"
              >
                <h3
                  className={`text-lg leading-snug font-semibold text-balance transition-colors sm:text-xl ${questionHoverClass}`}
                >
                  {item.question}
                </h3>
                {/* `text-current` is a deliberate no-op that keeps the chevron on
                  the row's own ink while the question reddens, and satisfies the
                  page-wide icon rule: a lucide glyph carrying `opacity-*` must
                  pair it with a SOLID colour, never a fractional one, or every
                  stroke crossing composites twice. See "never gives a decorative
                  icon a per-stroke alpha" in the what's-new page suite. */}
                <ChevronDown
                  aria-hidden
                  className="mt-1 size-5 shrink-0 text-current opacity-45 transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <div
                id={panelId}
                className="max-w-3xl pr-8 pb-7 text-base leading-8 opacity-72"
              >
                {item.answer}
              </div>
            </details>
          )
        })}
      </div>
    </>
  )
}
