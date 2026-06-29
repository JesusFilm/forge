"use client"

// Each prompt row is expandable. The forge `Video.studyQuestions` projection
// carries only the question text — no answer field — so the expanded body
// renders the same "no-answer" fallback the legacy core/apps/watch app shows
// for every question: a "Have a private discussion…" line plus two pill CTAs
// pointing at the public Chat / Ask-a-Bible-question endpoints. The
// placeholder row shown when there are no editorial prompts uses the same
// fallback. Mirrors core/apps/watch's DiscussionQuestions/Question.tsx.

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Mail as MailIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { MessageCircleIcon } from "@/components/sections/RelatedQuestions"
import { Button } from "@/components/ui/button"
import {
  WATCH_PILL_BUTTON_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"

const CHAT_WITH_PERSON_URL =
  "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch"
const ASK_BIBLE_QUESTION_URL =
  "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch"
const ASK_YOURS_URL = "https://issuesiface.com/talk?utm_source=jesusfilm-watch"
const PANEL_COLLAPSE_ANIMATION_MS = 300

function WatchQuestionIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="mt-0 size-6 shrink-0 text-white opacity-20 md:size-7"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 3.4A2.6 2.6 0 0 0 3.4 6v12A2.6 2.6 0 0 0 6 20.6h12a2.6 2.6 0 0 0 2.6-2.6V6A2.6 2.6 0 0 0 18 3.4H6ZM1.4 6A4.6 4.6 0 0 1 6 1.4h12A4.6 4.6 0 0 1 22.6 6v12a4.6 4.6 0 0 1-4.6 4.6H6A4.6 4.6 0 0 1 1.4 18V6Zm10.601 1.6c-.756 0-1.4.63-1.4 1.446a1 1 0 0 1-2 0c0-1.885 1.505-3.446 3.4-3.446s3.4 1.56 3.4 3.446a3.444 3.444 0 0 1-2.4 3.294l-.001.781a1 1 0 1 1-2 0v-1.153l.001-.478a1 1 0 0 1 1-.999c.756 0 1.4-.63 1.4-1.445 0-.816-.644-1.446-1.4-1.446ZM12 15.8a1 1 0 0 1 1 1v.043a1 1 0 1 1-2 0V16.8a1 1 0 0 1 1-1Z"
      />
    </svg>
  )
}

export function WatchStudyQuestions({ prompts }: { prompts: string[] }) {
  const t = useTranslations("WatchStudyQuestions")
  const hasPrompts = prompts.length > 0
  const items = hasPrompts ? prompts : [t("placeholderQuestion")]
  const itemTestId = hasPrompts
    ? "watch-study-questions-item"
    : "watch-study-questions-placeholder"
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  // Reset the open row whenever the prompts reference changes (e.g., when
  // the user navigates to a sibling video and the same component instance
  // receives a new prompts array). Using React's "adjusting state in
  // render" pattern — explicitly supported and safer than a useEffect
  // because it avoids the brief frame where a stale index points at the
  // wrong question's panel.
  const [prevPrompts, setPrevPrompts] = useState(prompts)
  if (prevPrompts !== prompts) {
    setPrevPrompts(prompts)
    setOpenIndex(null)
  }

  return (
    <section
      data-testid="watch-study-questions"
      aria-labelledby="watch-related-questions-heading"
      className="w-full pt-0"
    >
      {/* Keep this header flush with the right column top so Related
          Questions / Ask Yours align with the title / Download row. */}
      <div className="mb-4 flex flex-wrap items-center justify-between">
        <h2
          id="watch-related-questions-heading"
          className={`flex shrink-0 items-center gap-4 ${WATCH_SECTION_EYEBROW_CLASS}`}
        >
          <span className="md:hidden">{t("questionsShort")}</span>
          <span className="hidden md:inline">{t("questions")}</span>
        </h2>
        <Button
          variant="pill"
          nativeButton={false}
          className={WATCH_PILL_BUTTON_CLASS}
          aria-label={t("askYours")}
          data-testid="watch-study-questions-ask-yours"
          render={
            <a
              href={ASK_YOURS_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ cursor: "pointer" }}
            />
          }
        >
          <MessageCircleIcon />
          <span>{t("askYours")}</span>
        </Button>
      </div>

      <ul
        data-testid="watch-study-questions-list"
        className="relative flex flex-col"
      >
        {items.map((prompt, index) => (
          <StudyQuestionRow
            key={`${index}-${prompt}`}
            testId={itemTestId}
            question={prompt}
            fallbackBody={t("fallbackBody")}
            chatLabel={t("chatWithPerson")}
            askBibleLabel={t("askBibleQuestion")}
            isOpen={openIndex === index}
            onToggle={() =>
              setOpenIndex((prev) => (prev === index ? null : index))
            }
          />
        ))}
      </ul>
    </section>
  )
}

function StudyQuestionRow({
  testId,
  question,
  fallbackBody,
  chatLabel,
  askBibleLabel,
  isOpen,
  onToggle,
}: {
  testId: string
  question: string
  /** Localized "Have a private discussion…" body, threaded from the parent's t(). */
  fallbackBody: string
  /** Localized "Chat with a person" CTA label. */
  chatLabel: string
  /** Localized "Ask a Bible question" CTA label. */
  askBibleLabel: string
  isOpen: boolean
  onToggle: () => void
}) {
  const panelId = `${useId()}-panel`
  const panelContentRef = useRef<HTMLDivElement>(null)
  const [renderPanel, setRenderPanel] = useState(isOpen)
  const [panelHeight, setPanelHeight] = useState(0)
  const panelVisible = isOpen || renderPanel

  useEffect(() => {
    if (isOpen || !renderPanel) return
    const timeout = window.setTimeout(() => {
      setRenderPanel(false)
    }, PANEL_COLLAPSE_ANIMATION_MS)
    return () => window.clearTimeout(timeout)
  }, [isOpen, renderPanel])

  useEffect(() => {
    if (!panelVisible) return

    const content = panelContentRef.current
    if (!content) return

    if (isOpen) {
      const frame = window.requestAnimationFrame(() => {
        setPanelHeight(content.scrollHeight)
      })
      return () => window.cancelAnimationFrame(frame)
    }

    const frame = window.requestAnimationFrame(() => {
      setPanelHeight(0)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isOpen, panelVisible, fallbackBody, chatLabel, askBibleLabel])

  return (
    <li data-testid={testId} className="border-b border-stone-500/20">
      <button
        type="button"
        onClick={() => {
          if (isOpen) setRenderPanel(true)
          onToggle()
        }}
        aria-expanded={isOpen}
        aria-controls={panelId}
        data-testid={`${testId}-trigger`}
        className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-0 py-4 text-left text-sm font-medium transition-all outline-none hover:no-underline focus-visible:ring-[3px] focus-visible:ring-white/40"
      >
        <div className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-6 text-left md:grid-cols-[1.75rem_minmax(0,1fr)]">
          <WatchQuestionIcon />
          <h3 className="text-base leading-[1.6] font-normal text-stone-100 transition-colors group-hover:text-brand-red md:text-lg md:text-balance">
            {question}
          </h3>
        </div>
        <span className="hidden shrink-0 text-stone-400 transition-colors group-hover:text-white sm:block">
          <ChevronDown
            aria-hidden="true"
            className={`size-6 transition-transform duration-200 md:size-7 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>
      {panelVisible ? (
        <div
          id={panelId}
          data-testid={`${testId}-panel`}
          aria-hidden={!isOpen}
          className={`overflow-hidden transition-[height] duration-300 ease-out ${
            isOpen ? "" : "pointer-events-none"
          }`}
          style={{ height: panelHeight }}
        >
          <div ref={panelContentRef} className="pt-2 pr-2 pb-6 pl-12">
            <p
              data-testid={`${testId}-fallback-body`}
              className="leading-relaxed font-normal text-stone-200/80"
            >
              {fallbackBody}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="pill"
                nativeButton={false}
                className={WATCH_PILL_BUTTON_CLASS}
                data-testid="watch-study-questions-chat-cta"
                render={
                  <a
                    href={CHAT_WITH_PERSON_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabIndex={isOpen ? undefined : -1}
                  />
                }
              >
                <MessageCircleIcon />
                <span>{chatLabel}</span>
              </Button>
              <Button
                variant="pill"
                nativeButton={false}
                className={WATCH_PILL_BUTTON_CLASS}
                data-testid="watch-study-questions-ask-bible-cta"
                render={
                  <a
                    href={ASK_BIBLE_QUESTION_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabIndex={isOpen ? undefined : -1}
                  />
                }
              >
                <MailIcon className="size-4" aria-hidden="true" />
                <span>{askBibleLabel}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  )
}
