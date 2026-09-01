"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import Markdown from "react-markdown"
import { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import { Button } from "@/components/ui/button"
import { WatchFaqList } from "@/components/watch/WatchFaqList"

export { relatedQuestionsFragment }

type RelatedQuestionsProps = {
  data: FragmentOf<typeof relatedQuestionsFragment>
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

/**
 * The FAQ presentation lives in `WatchFaqList`, shared with the Watch
 * "what's new" page's FAQ. This owns the block's own wrapper, the "Ask yours"
 * CTA, and the single-open accordion state.
 *
 * No ink is set here: the enclosing `Section` supplies it (`text-white` or
 * `text-stone-900` depending on the editor's background choice) and every
 * value in the shared list derives from it.
 */
export function RelatedQuestions({ data }: RelatedQuestionsProps) {
  const t = useTranslations("WatchStudyQuestions")
  const { id, sectionKey, heading, questions } = data
  const ctaLabel = String((data as Record<string, unknown>).ctaLabel ?? "")
  const ctaLink = String((data as Record<string, unknown>).ctaLink ?? "")
  // Identify each question by its array index. Admin's
  // `RelatedQuestionItemSchema` (apps/admin/src/domain/blocks.ts) does
  // NOT carry an `id` field on individual items — only `question` +
  // `answer` — so `q.id` is `undefined` for every item. Without an
  // index-based identifier, every row shares one identity and opening one
  // expands all of them.
  const [openId, setOpenId] = useState<string | null>(null)

  const items = useMemo(() => {
    const valid =
      questions?.filter(
        (q: LegacyFragmentValue): q is NonNullable<typeof q> => q != null,
      ) ?? []

    return valid.map((q: LegacyFragmentValue, idx: number) => ({
      id: `q-${idx}`,
      question: q.question ?? "",
      answer: (
        <Markdown
          components={{
            ul: ({ children }) => (
              <ul className="mt-2 list-disc space-y-2 pl-6">{children}</ul>
            ),
            li: ({ children }) => <li>{children}</li>,
            p: ({ children }) => <p>{children}</p>,
          }}
        >
          {q.answer ?? ""}
        </Markdown>
      ),
    }))
  }, [questions])

  if (!items.length) return null

  // One row at a time. `<details>` reports React's own writes back through
  // `onToggle`, so closing a row must match on identity — otherwise the echo
  // from the row React just closed would clear the row the user opened.
  const handleToggle = (toggledId: string, isOpen: boolean) => {
    setOpenId((current) => {
      if (isOpen) return toggledId
      return current === toggledId ? null : current
    })
  }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="RelatedQuestionsSection"
      className="w-full pt-6 xl:pt-4"
    >
      <WatchFaqList
        items={items}
        openIds={openId == null ? [] : [openId]}
        onToggle={handleToggle}
        heading={heading ?? undefined}
        itemTestId="RelatedQuestionsItem"
        headerAction={
          ctaLink ? (
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
          ) : null
        }
      />
    </section>
  )
}
