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
  videoId: string
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
  "group flex min-h-15 w-full cursor-pointer items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-left text-white transition-[background-color,border-color,transform] hover:border-white/28 hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none motion-reduce:transition-none"

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true")
}

export function WatchEndReflection({
  open,
  videoId,
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
    setStep("reflection")
    setPromptIndex(0)
  }, [videoId, open])

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
      className="absolute inset-0 z-50 flex items-end overflow-y-auto bg-black/72 px-4 py-5 text-white backdrop-blur-[14px] animate-overlay-fade-in focus:outline-none sm:items-center sm:px-8 sm:py-10 motion-reduce:animate-none"
    >
      <section className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/14 bg-stone-950/80 shadow-2xl shadow-black/65">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(239,51,64,0.24),transparent_34%),radial-gradient(circle_at_95%_5%,rgba(255,255,255,0.1),transparent_28%)]"
        />
        <div className="relative p-6 sm:p-10">
          <button
            type="button"
            aria-label={t("dismiss")}
            data-testid="watch-end-reflection-dismiss"
            onClick={onDismiss}
            className="absolute top-5 right-5 grid size-10 cursor-pointer place-items-center rounded-full border border-white/14 bg-white/[0.06] text-white/80 transition hover:bg-white/[0.15] hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
          >
            <X aria-hidden className="size-5" />
          </button>

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
              <p className="mt-6 text-sm font-medium text-white/60">
                {t("questionProgress", {
                  current: promptIndex + 1,
                  total: reflectionPrompts.length,
                })}
              </p>
              <h2
                id="watch-end-reflection-title"
                data-testid="watch-end-reflection-question"
                className="mt-3 max-w-[19ch] text-3xl leading-[1.08] font-semibold text-balance sm:text-5xl"
              >
                {currentPrompt}
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/72 sm:text-lg">
                {t("reflectionSupport")}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                {promptIndex > 0 ? (
                  <button
                    type="button"
                    data-testid="watch-end-reflection-back"
                    onClick={() => setPromptIndex((current) => current - 1)}
                    className={SECONDARY_ACTION_CLASS}
                  >
                    <ArrowLeft aria-hidden className="size-4" />
                    {t("back")}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="watch-end-reflection-continue"
                  onClick={advance}
                  className={PRIMARY_ACTION_CLASS}
                >
                  {isLastPrompt ? t("seeNextSteps") : t("nextQuestion")}
                  <ArrowRight aria-hidden className="size-4" />
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
                className="mt-4 max-w-[17ch] text-3xl leading-[1.08] font-semibold text-balance sm:text-5xl"
              >
                {t("nextStepsTitle")}
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/72 sm:text-lg">
                {t("nextStepsSupport")}
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
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

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="watch-end-reflection-more"
                  onClick={() => setStep("reflection")}
                  className={SECONDARY_ACTION_CLASS}
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
