"use client"

import { useId, useState, type CSSProperties } from "react"
import {
  Compass,
  Globe2,
  Handshake,
  Share2,
  type LucideIcon,
} from "lucide-react"

import {
  WHATS_NEW_SELF_ID,
  type WhatsNewIconKey,
} from "@/components/whats-new/whats-new-content"

type SelfIdOption = (typeof WHATS_NEW_SELF_ID.options)[number]

const ICONS: Partial<Record<WhatsNewIconKey, LucideIcon>> = {
  compass: Compass,
  share: Share2,
  handshake: Handshake,
  globe: Globe2,
}

/**
 * "Which of these is you?" — the self-identification question that closes
 * the audiences section.
 *
 * Native radios in a `fieldset`/`legend`, rather than the `aria-pressed`
 * button row used in the feedback composer: this is one choice out of
 * four, so a real radio group gives arrow-key navigation and is announced
 * as "1 of 4" against the question itself without any ARIA of our own.
 * The input is `sr-only` and the label carries the visuals, so the whole
 * card is the hit target; focus is drawn with `focus-within` on the label
 * because the focused element itself is invisible.
 *
 * The response is `role="status"` so it is announced when it swaps, and
 * every option stays on screen after a pick — changing your answer is the
 * point, so there is no separate reset affordance.
 */
export function WhatsNewSelfId() {
  const groupName = useId()
  const [pickedId, setPickedId] = useState<SelfIdOption["id"] | null>(null)
  const picked =
    WHATS_NEW_SELF_ID.options.find((option) => option.id === pickedId) ?? null

  return (
    <div
      data-testid="whats-new-self-id"
      className="mt-12 rounded-3xl border border-white/12 bg-white/[0.03] p-6 backdrop-blur-sm sm:p-9 lg:mt-16 lg:p-12"
    >
      <p className="text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/70 uppercase">
        {WHATS_NEW_SELF_ID.eyebrow}
      </p>

      <fieldset className="mt-5 border-0 p-0">
        <legend className="max-w-2xl text-xl leading-snug font-semibold tracking-[-0.01em] text-balance text-white sm:text-2xl lg:text-3xl">
          {WHATS_NEW_SELF_ID.question}
        </legend>
        <p className="mt-3 text-sm text-white/60">{WHATS_NEW_SELF_ID.helper}</p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {WHATS_NEW_SELF_ID.options.map((option) => {
            const Icon = ICONS[option.icon]
            const selected = option.id === pickedId

            return (
              <label
                key={option.id}
                data-testid="whats-new-self-id-option"
                data-option={option.id}
                data-selected={selected ? "" : undefined}
                style={{ "--tint": option.tint } as CSSProperties}
                className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 text-left transition-colors duration-200 focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-white sm:p-5 ${
                  selected
                    ? "border-[color-mix(in_oklab,var(--tint)_70%,transparent)] bg-[color-mix(in_oklab,var(--tint)_14%,transparent)]"
                    : "border-white/12 bg-white/[0.02] hover:border-white/28 hover:bg-white/[0.05]"
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option.id}
                  checked={selected}
                  onChange={() => setPickedId(option.id)}
                  data-testid={`whats-new-self-id-radio-${option.id}`}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  style={{ color: option.tint }}
                  className="grid size-11 shrink-0 place-items-center rounded-xl border border-[color-mix(in_oklab,var(--tint)_45%,transparent)] bg-[color-mix(in_oklab,var(--tint)_18%,transparent)]"
                >
                  {Icon ? <Icon className="size-5" /> : null}
                </span>
                <span className="text-sm font-semibold text-white sm:text-base">
                  {option.label}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* The live region is mounted from the start and only its CONTENTS
          swap. A `role="status"` element inserted at the same moment as its
          text is announced inconsistently across screen readers, and the
          first answer is the one that matters most. */}
      <div
        role="status"
        data-testid="whats-new-self-id-live"
        className={picked ? "mt-8 border-t border-white/12 pt-7" : undefined}
      >
        {picked ? (
          <div data-testid="whats-new-self-id-answer" data-option={picked.id}>
            <p
              className="text-[0.6875rem] font-semibold tracking-[0.28em] uppercase"
              style={{ color: picked.tint }}
            >
              {WHATS_NEW_SELF_ID.answerLabel}
            </p>
            <p className="mt-3 max-w-3xl text-base leading-8 text-white/80 sm:text-lg">
              {picked.response}
            </p>
          </div>
        ) : null}
      </div>

      <p className="mt-7 text-xs leading-6 text-white/45">
        {WHATS_NEW_SELF_ID.note}
      </p>
    </div>
  )
}
