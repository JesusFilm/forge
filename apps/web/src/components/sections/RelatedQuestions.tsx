import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import Markdown from "react-markdown"
import { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import { Button } from "@/components/ui/button"
import { WATCH_FAQ_HEADING_CLASS } from "@/components/watch/watch-faq-classes"
import { MessageCircleIcon } from "./MessageCircleIcon"
import { RelatedQuestionsList } from "./RelatedQuestionsList"

export { relatedQuestionsFragment }

type RelatedQuestionsProps = {
  data: FragmentOf<typeof relatedQuestionsFragment>
}

/**
 * Only `ul` needs an override — react-markdown's own `li` and `p` renderers
 * already emit exactly those tags, and the answer's line-height comes from the
 * wrapper in `WatchFaqList`. Hoisted so it is not reallocated per question.
 */
const MARKDOWN_ANSWER_COMPONENTS = {
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mt-2 list-disc space-y-2 pl-6">{children}</ul>
  ),
}

/**
 * The FAQ presentation lives in `WatchFaqList`, shared with the Watch
 * "what's new" page's FAQ. This owns the block's own wrapper and the "Ask
 * yours" CTA; `RelatedQuestionsList` owns the single-open accordion state.
 *
 * Deliberately not a client component. Where the section renderer runs on the
 * server (Watch home, Experience pages) the answers' Markdown is rendered
 * there, so react-markdown and its micromark parser stay out of the browser
 * bundle. Under a client renderer (`WatchSectionRenderer`) it simply becomes
 * part of that client graph, as before.
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
  const valid =
    questions?.filter(
      (q: LegacyFragmentValue): q is NonNullable<typeof q> => q != null,
    ) ?? []
  const items = valid.map((q: LegacyFragmentValue, idx: number) => ({
    id: `q-${idx}`,
    question: q.question ?? "",
    answer: (
      <Markdown components={MARKDOWN_ANSWER_COMPONENTS}>
        {q.answer ?? ""}
      </Markdown>
    ),
  }))

  if (!items.length) return null

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="RelatedQuestionsSection"
      className="w-full pt-6 xl:pt-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        {heading && (
          <h2 className={`max-w-2xl ${WATCH_FAQ_HEADING_CLASS}`}>{heading}</h2>
        )}

        {ctaLink ? (
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
        ) : null}
      </div>

      <div className="mt-10 lg:mt-14">
        <RelatedQuestionsList items={items} />
      </div>
    </section>
  )
}
