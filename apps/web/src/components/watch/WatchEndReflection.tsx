"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Download,
  ExternalLink,
  HeartHandshake,
  MessageCircleHeart,
  Play,
  Share2,
  Sparkles,
  X,
} from "lucide-react"
import { useTranslations } from "next-intl"

import {
  ASK_BIBLE_QUESTION_URL,
  CHAT_WITH_PERSON_URL,
  JOIN_BIBLE_STUDY_URL,
} from "@/components/watch/watch-next-step-links"

type WatchEndReflectionProps = {
  open: boolean
  prompts: string[]
  bibleReadHref?: string | null
  onDownload?: () => void
  onNext?: () => void
  onReplay: () => void
  onShare?: () => void
  onDismiss: () => void
}

const PRIMARY_ACTION_CLASS =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-red px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
const SECONDARY_ACTION_CLASS =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/18 bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
const STEP_ACTION_CLASS =
  "group flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-left text-white transition-[background-color,border-color,transform] hover:border-white/28 hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none motion-reduce:transition-none"

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true")
}

export function WatchEndReflection({
  open,
  prompts,
  bibleReadHref = null,
  onDownload,
  onNext,
  onReplay,
  onShare,
  onDismiss,
}: WatchEndReflectionProps) {
  const t = useTranslations("WatchEndReflection")
  const tStudyQuestions = useTranslations("WatchStudyQuestions")
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<"reflection" | "next-steps">("reflection")
  const [promptIndex, setPromptIndex] = useState(0)
  const cleanedPrompts = prompts.filter((prompt) => prompt.trim().length > 0)
  const reflectionPrompts =
    cleanedPrompts.length > 0
      ? cleanedPrompts
      : [tStudyQuestions("placeholderQuestion")]
  const currentPrompt = reflectionPrompts[promptIndex]!
  const isLastPrompt = promptIndex === reflectionPrompts.length - 1

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      surfaceRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  if (!open) return null

  const advance = () => {
    if (isLastPrompt) {
      setStep("next-steps")
      return
    }
    setPromptIndex((current) => current + 1)
  }

  return (
    <div
      ref={surfaceRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="watch-end-reflection-title"
      data-testid="watch-end-reflection"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onDismiss()
          return
        }
        if (event.key !== "Tab") return

        const focusableElements = getFocusableElements(event.currentTarget)
        if (focusableElements.length === 0) {
          event.preventDefault()
          return
        }

        const firstElement = focusableElements[0]!
        const lastElement = focusableElements.at(-1)!
        const activeElement = document.activeElement
        const shouldWrapBackward =
          event.shiftKey &&
          (activeElement === firstElement ||
            activeElement === event.currentTarget)
        const shouldWrapForward =
          !event.shiftKey &&
          (activeElement === lastElement ||
            activeElement === event.currentTarget)

        if (shouldWrapBackward) {
          event.preventDefault()
          lastElement.focus()
        } else if (shouldWrapForward) {
          event.preventDefault()
          firstElement.focus()
        }
      }}
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-black/88 text-white backdrop-blur-[14px] animate-overlay-fade-in focus:outline-none motion-reduce:animate-none"
    >
      <section
        data-testid="watch-end-reflection-content"
        className={`relative mx-auto flex min-h-full w-full flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-10 sm:py-8 ${
          step === "reflection" ? "max-w-3xl" : "max-w-5xl"
        }`}
      >
        <div className="sticky top-[max(1rem,env(safe-area-inset-top))] z-10 ml-auto h-11">
          <button
            type="button"
            aria-label={t("dismiss")}
            data-testid="watch-end-reflection-dismiss"
            onClick={onDismiss}
            className="grid size-11 cursor-pointer place-items-center rounded-full bg-black/45 text-white/75 backdrop-blur-md transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col justify-center py-6 sm:py-10">
          {step === "reflection" ? (
            <div
              key={`reflection-${promptIndex}`}
              data-testid="watch-end-reflection-panel"
              className="animate-watch-reflection-enter motion-reduce:animate-none"
            >
              <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">
                <Sparkles aria-hidden className="size-4 text-brand-red" />
                <span>{t("eyebrow")}</span>
              </div>
              <p
                aria-atomic="true"
                aria-live="polite"
                data-testid="watch-end-reflection-announcement"
                className="sr-only"
              >
                {t("questionProgress", {
                  current: promptIndex + 1,
                  total: reflectionPrompts.length,
                })}{" "}
                {currentPrompt}
              </p>
              <p className="mt-5 text-sm font-medium text-white/60 sm:mt-6">
                {t("questionProgress", {
                  current: promptIndex + 1,
                  total: reflectionPrompts.length,
                })}
              </p>
              <h2
                id="watch-end-reflection-title"
                data-testid="watch-end-reflection-question"
                className="mt-3 max-w-[19ch] text-[clamp(2rem,9vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.025em] text-balance"
              >
                {currentPrompt}
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/72 sm:text-lg">
                {t("reflectionSupport")}
              </p>

              <div className="mt-8 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
                {promptIndex > 0 ? (
                  <button
                    type="button"
                    data-testid="watch-end-reflection-back"
                    onClick={() => setPromptIndex((current) => current - 1)}
                    className={`${SECONDARY_ACTION_CLASS} sm:flex-none`}
                  >
                    <ArrowLeft aria-hidden className="size-4" />
                    {t("back")}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="watch-end-reflection-continue"
                  onClick={advance}
                  className={`${PRIMARY_ACTION_CLASS} ${
                    promptIndex === 0 ? "col-span-2" : ""
                  } sm:flex-none`}
                >
                  {isLastPrompt ? t("seeNextSteps") : t("nextQuestion")}
                  <ArrowRight aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  data-testid="watch-end-reflection-replay"
                  onClick={onReplay}
                  className="col-span-2 min-h-12 cursor-pointer px-2 text-sm font-semibold text-white/72 underline decoration-white/35 underline-offset-4 transition hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none sm:col-span-1"
                >
                  {t("replay")}
                </button>
              </div>
            </div>
          ) : (
            <div
              key="next-steps"
              data-testid="watch-end-reflection-panel"
              className="animate-watch-reflection-enter motion-reduce:animate-none"
            >
              <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">
                <HeartHandshake aria-hidden className="size-4 text-brand-red" />
                <span>{t("nextStepsEyebrow")}</span>
              </div>
              <h2
                id="watch-end-reflection-title"
                className="mt-4 max-w-[17ch] text-[clamp(2rem,8vw,3.25rem)] leading-[1.05] font-semibold tracking-[-0.025em] text-balance"
              >
                {t("nextStepsTitle")}
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/72 sm:text-lg">
                {t("nextStepsSupport")}
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {bibleReadHref ? (
                  <ExternalNextStep
                    href={bibleReadHref}
                    icon={<BookOpenText aria-hidden className="size-5" />}
                    label={t("readInBible")}
                    detail={t("readInBibleDetail")}
                    testId="watch-end-reflection-read-bible"
                  />
                ) : null}
                <ExternalNextStep
                  href={ASK_BIBLE_QUESTION_URL}
                  icon={<MessageCircleHeart aria-hidden className="size-5" />}
                  label={t("askBibleQuestion")}
                  detail={t("askBibleQuestionDetail")}
                  testId="watch-end-reflection-ask-bible"
                />
                <ExternalNextStep
                  href={CHAT_WITH_PERSON_URL}
                  icon={<HeartHandshake aria-hidden className="size-5" />}
                  label={t("talkToPerson")}
                  detail={t("talkToPersonDetail")}
                  testId="watch-end-reflection-talk-person"
                />
                <ExternalNextStep
                  href={JOIN_BIBLE_STUDY_URL}
                  icon={<Sparkles aria-hidden className="size-5" />}
                  label={t("goDeeper")}
                  detail={t("goDeeperDetail")}
                  testId="watch-end-reflection-go-deeper"
                />
                {onNext ? (
                  <button
                    type="button"
                    data-testid="watch-end-reflection-next-watch"
                    onClick={onNext}
                    className={STEP_ACTION_CLASS}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-red text-white">
                      <Play aria-hidden className="size-4 fill-current" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {t("watchNext")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-white/60">
                        {t("watchNextDetail")}
                      </span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 text-white/55" />
                  </button>
                ) : null}
                {onShare ? (
                  <button
                    type="button"
                    data-testid="watch-end-reflection-share"
                    onClick={onShare}
                    className={STEP_ACTION_CLASS}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white">
                      <Share2 aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {t("share")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-white/60">
                        {t("shareDetail")}
                      </span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 text-white/55" />
                  </button>
                ) : null}
                {onDownload ? (
                  <button
                    type="button"
                    data-testid="watch-end-reflection-download"
                    onClick={onDownload}
                    className={STEP_ACTION_CLASS}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white">
                      <Download aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {t("download")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-white/60">
                        {t("downloadDetail")}
                      </span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 text-white/55" />
                  </button>
                ) : null}
              </div>

              <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <button
                  type="button"
                  data-testid="watch-end-reflection-more"
                  onClick={() => setStep("reflection")}
                  className={`${SECONDARY_ACTION_CLASS} sm:flex-none`}
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  {t("moreReflection")}
                </button>
                <button
                  type="button"
                  data-testid="watch-end-reflection-replay"
                  onClick={onReplay}
                  className="min-h-12 cursor-pointer px-2 text-sm font-semibold text-white/72 underline decoration-white/35 underline-offset-4 transition hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
                >
                  {t("replay")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ExternalNextStep({
  href,
  icon,
  label,
  detail,
  testId,
}: {
  href: string
  icon: ReactNode
  label: string
  detail: string
  testId: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={STEP_ACTION_CLASS}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-white/60">
          {detail}
        </span>
      </span>
      <ExternalLink aria-hidden className="size-4 text-white/55" />
    </a>
  )
}
