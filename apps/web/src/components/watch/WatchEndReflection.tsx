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
  SendHorizontal,
  Share2,
  Sparkles,
  UserRound,
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

type ReflectionView = "actions" | "ask" | "talk" | "share"

type NextStepAction = {
  id: string
  icon: ReactNode
  label: string
  detail: string
  href?: string
  onClick?: () => void
  testId: string
}

const ACTION_REVEAL_INTERVAL_MS = 850
const FINAL_HIGHLIGHT_DURATION_MS = 1400

const PRIMARY_ACTION_CLASS =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-red px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
const SECONDARY_ACTION_CLASS =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/18 bg-white/[0.08] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
const STEP_ACTION_CLASS =
  "group flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left text-white transition-[opacity,transform,background-color,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none"

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getAttribute("tabindex") !== "-1",
  )
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
  const tQuestionPanel = useTranslations("WatchQuestionPanel")
  const surfaceRef = useRef<HTMLDivElement>(null)
  const cleanedPrompts = prompts.filter((prompt) => prompt.trim().length > 0)
  const reflectionPrompts = (
    cleanedPrompts.length > 0
      ? cleanedPrompts
      : [tStudyQuestions("placeholderQuestion")]
  ).slice(0, 3)
  const actionCount =
    3 +
    Number(onShare != null) +
    Number(bibleReadHref != null) +
    Number(onNext != null) +
    Number(onDownload != null)
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const [view, setView] = useState<ReflectionView>("actions")
  const [revealedCount, setRevealedCount] = useState(
    reducedMotion ? actionCount : 1,
  )
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(
    reducedMotion ? null : 0,
  )
  const [customQuestion, setCustomQuestion] = useState("")

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      surfaceRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (view !== "actions" || reducedMotion || highlightedIndex == null) {
      return
    }

    const isLastReveal = revealedCount >= actionCount
    const timeout = window.setTimeout(
      () => {
        if (isLastReveal) {
          setHighlightedIndex(null)
          return
        }
        setRevealedCount((current) => Math.min(current + 1, actionCount))
        setHighlightedIndex((current) =>
          current == null ? 0 : Math.min(current + 1, actionCount - 1),
        )
      },
      isLastReveal ? FINAL_HIGHLIGHT_DURATION_MS : ACTION_REVEAL_INTERVAL_MS,
    )

    return () => window.clearTimeout(timeout)
  }, [actionCount, highlightedIndex, reducedMotion, revealedCount, view])

  if (!open) return null

  const openDetail = (nextView: Exclude<ReflectionView, "actions">) => {
    setHighlightedIndex(null)
    setRevealedCount(actionCount)
    setView(nextView)
  }

  const actions: NextStepAction[] = [
    {
      id: "ask",
      icon: <MessageCircleHeart aria-hidden className="size-5" />,
      label: t("askBibleQuestion"),
      detail: t("askBibleQuestionDetail"),
      onClick: () => openDetail("ask"),
      testId: "watch-end-reflection-ask-bible",
    },
    {
      id: "talk",
      icon: <HeartHandshake aria-hidden className="size-5" />,
      label: t("talkToPerson"),
      detail: t("talkToPersonDetail"),
      onClick: () => openDetail("talk"),
      testId: "watch-end-reflection-talk-person",
    },
    ...(onShare
      ? [
          {
            id: "share",
            icon: <Share2 aria-hidden className="size-5" />,
            label: t("share"),
            detail: t("shareDetail"),
            onClick: () => openDetail("share"),
            testId: "watch-end-reflection-share",
          },
        ]
      : []),
    ...(bibleReadHref
      ? [
          {
            id: "read",
            icon: <BookOpenText aria-hidden className="size-5" />,
            label: t("readInBible"),
            detail: t("readInBibleDetail"),
            href: bibleReadHref,
            testId: "watch-end-reflection-read-bible",
          },
        ]
      : []),
    {
      id: "deeper",
      icon: <Sparkles aria-hidden className="size-5" />,
      label: t("goDeeper"),
      detail: t("goDeeperDetail"),
      href: JOIN_BIBLE_STUDY_URL,
      testId: "watch-end-reflection-go-deeper",
    },
    ...(onNext
      ? [
          {
            id: "next",
            icon: <Play aria-hidden className="size-4 fill-current" />,
            label: t("watchNext"),
            detail: t("watchNextDetail"),
            onClick: onNext,
            testId: "watch-end-reflection-next-watch",
          },
        ]
      : []),
    ...(onDownload
      ? [
          {
            id: "download",
            icon: <Download aria-hidden className="size-5" />,
            label: t("download"),
            detail: t("downloadDetail"),
            onClick: onDownload,
            testId: "watch-end-reflection-download",
          },
        ]
      : []),
  ]

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
          if (view !== "actions") {
            setView("actions")
          } else {
            onDismiss()
          }
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
          view === "actions" ? "max-w-5xl" : "max-w-3xl"
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
          {view === "actions" ? (
            <ActionsView
              actions={actions}
              highlightedIndex={highlightedIndex}
              revealedCount={revealedCount}
              replayLabel={t("replay")}
              title={t("nextStepsTitle")}
              support={t("nextStepsSupport")}
              eyebrow={t("nextStepsEyebrow")}
              onReplay={onReplay}
            />
          ) : null}
          {view === "ask" ? (
            <AskView
              prompts={reflectionPrompts}
              customQuestion={customQuestion}
              title={t("askBibleQuestion")}
              detail={t("askBibleQuestionDetail")}
              fieldLabel={tQuestionPanel("fieldLabel")}
              backLabel={t("back")}
              onBack={() => setView("actions")}
              onQuestionChange={setCustomQuestion}
            />
          ) : null}
          {view === "talk" ? (
            <TalkView
              title={t("talkToPerson")}
              detail={t("talkToPersonDetail")}
              backLabel={t("back")}
              onBack={() => setView("actions")}
            />
          ) : null}
          {view === "share" && onShare ? (
            <ShareView
              title={t("share")}
              detail={t("shareDetail")}
              backLabel={t("back")}
              onBack={() => setView("actions")}
              onShare={onShare}
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}

function ActionsView({
  actions,
  highlightedIndex,
  revealedCount,
  replayLabel,
  title,
  support,
  eyebrow,
  onReplay,
}: {
  actions: NextStepAction[]
  highlightedIndex: number | null
  revealedCount: number
  replayLabel: string
  title: string
  support: string
  eyebrow: string
  onReplay: () => void
}) {
  return (
    <div
      key="actions"
      data-testid="watch-end-reflection-panel"
      className="animate-watch-reflection-enter motion-reduce:animate-none"
    >
      <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-white/60 uppercase">
        <HeartHandshake aria-hidden className="size-4 text-brand-red" />
        <span>{eyebrow}</span>
      </div>
      <h2
        id="watch-end-reflection-title"
        className="mt-4 max-w-[17ch] text-[clamp(2rem,8vw,3.25rem)] leading-[1.05] font-semibold tracking-[-0.025em] text-balance"
      >
        {title}
      </h2>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-white/72 sm:text-lg">
        {support}
      </p>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((action, index) => (
          <NextStepCard
            key={action.id}
            action={action}
            active={highlightedIndex === index}
            revealed={index < revealedCount}
          />
        ))}
      </div>

      <button
        type="button"
        data-testid="watch-end-reflection-replay"
        onClick={onReplay}
        className="mt-6 min-h-12 cursor-pointer px-2 text-sm font-semibold text-white/72 underline decoration-white/35 underline-offset-4 transition hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
      >
        {replayLabel}
      </button>
    </div>
  )
}

function NextStepCard({
  action,
  active,
  revealed,
}: {
  action: NextStepAction
  active: boolean
  revealed: boolean
}) {
  const className = `${STEP_ACTION_CLASS} ${
    revealed
      ? "translate-y-0 border-white/12 bg-white/[0.06] opacity-100 hover:border-white/28 hover:bg-white/[0.12]"
      : "pointer-events-none translate-y-2 border-white/5 bg-white/[0.025] opacity-25"
  } ${
    active
      ? "scale-[1.015] border-brand-red/85 bg-brand-red/[0.13] shadow-[0_0_0_1px_rgba(239,51,64,0.24),0_12px_36px_rgba(239,51,64,0.12)]"
      : ""
  }`
  const content = (
    <>
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-full text-white transition-colors duration-500 ${
          active ? "bg-brand-red" : "bg-white/10"
        }`}
      >
        {action.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{action.label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-white/60">
          {action.detail}
        </span>
      </span>
      {action.href ? (
        <ExternalLink aria-hidden className="size-4 text-white/55" />
      ) : (
        <ArrowRight aria-hidden className="size-4 text-white/55" />
      )}
    </>
  )

  if (action.href) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-hidden={!revealed}
        tabIndex={revealed ? undefined : -1}
        data-testid={action.testId}
        data-action-id={action.id}
        data-highlighted={active ? "true" : "false"}
        data-revealed={revealed ? "true" : "false"}
        className={className}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      aria-hidden={!revealed}
      tabIndex={revealed ? undefined : -1}
      data-testid={action.testId}
      data-action-id={action.id}
      data-highlighted={active ? "true" : "false"}
      data-revealed={revealed ? "true" : "false"}
      className={className}
    >
      {content}
    </button>
  )
}

function DetailHeader({
  icon,
  title,
  detail,
}: {
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <>
      <div className="grid size-12 place-items-center rounded-full bg-brand-red text-white">
        {icon}
      </div>
      <h2
        id="watch-end-reflection-title"
        className="mt-5 max-w-[18ch] text-[clamp(2rem,8vw,3.25rem)] leading-[1.05] font-semibold tracking-[-0.025em] text-balance"
      >
        {title}
      </h2>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-white/72 sm:text-lg">
        {detail}
      </p>
    </>
  )
}

function AskView({
  prompts,
  customQuestion,
  title,
  detail,
  fieldLabel,
  backLabel,
  onBack,
  onQuestionChange,
}: {
  prompts: string[]
  customQuestion: string
  title: string
  detail: string
  fieldLabel: string
  backLabel: string
  onBack: () => void
  onQuestionChange: (question: string) => void
}) {
  return (
    <div
      data-testid="watch-end-reflection-ask-panel"
      className="animate-watch-reflection-enter motion-reduce:animate-none"
    >
      <DetailHeader
        icon={<MessageCircleHeart aria-hidden className="size-6" />}
        title={title}
        detail={detail}
      />
      <div className="mt-7 flex flex-col gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            data-testid="watch-end-reflection-suggested-question"
            onClick={() => onQuestionChange(prompt)}
            className="cursor-pointer rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-3 text-left text-sm leading-relaxed text-white/80 transition hover:border-white/30 hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
          >
            {prompt}
          </button>
        ))}
      </div>
      <label className="mt-5 block text-sm font-semibold text-white/72">
        <span>{fieldLabel}</span>
        <textarea
          value={customQuestion}
          onChange={(event) => onQuestionChange(event.target.value)}
          rows={3}
          data-testid="watch-end-reflection-question-input"
          className="mt-2 block min-h-28 w-full resize-y rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-base leading-relaxed text-white placeholder:text-white/35 focus:border-brand-red/80 focus:ring-2 focus:ring-brand-red/30 focus:outline-none"
        />
      </label>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="watch-end-reflection-detail-back"
          onClick={onBack}
          className={SECONDARY_ACTION_CLASS}
        >
          <ArrowLeft aria-hidden className="size-4" />
          {backLabel}
        </button>
        <a
          href={ASK_BIBLE_QUESTION_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="watch-end-reflection-ask-submit"
          className={PRIMARY_ACTION_CLASS}
        >
          <SendHorizontal aria-hidden className="size-4" />
          {title}
        </a>
      </div>
    </div>
  )
}

function TalkView({
  title,
  detail,
  backLabel,
  onBack,
}: {
  title: string
  detail: string
  backLabel: string
  onBack: () => void
}) {
  const languages = ["EN", "ES", "FR", "PT"]
  const languageNames = ["English", "Español", "Français", "Português"]

  return (
    <div
      data-testid="watch-end-reflection-talk-panel"
      className="animate-watch-reflection-enter motion-reduce:animate-none"
    >
      <DetailHeader
        icon={<HeartHandshake aria-hidden className="size-6" />}
        title={title}
        detail={detail}
      />
      <div className="mt-8 flex -space-x-3" aria-hidden="true">
        {languages.map((language, index) => (
          <span
            key={language}
            className="relative grid size-16 place-items-center rounded-full border-2 border-black bg-stone-800 text-white shadow-xl"
          >
            <UserRound className="size-7 text-white/80" />
            <span className="absolute right-0 bottom-0 rounded-full bg-brand-red px-1.5 py-0.5 text-[9px] font-bold tracking-wide">
              {language}
            </span>
            <span
              aria-hidden="true"
              className={`absolute inset-0 -z-10 rounded-full ${
                index % 2 === 0 ? "bg-brand-red/20" : "bg-white/10"
              }`}
            />
          </span>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {languageNames.map((language) => (
          <span
            key={language}
            className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/72"
          >
            {language}
          </span>
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="watch-end-reflection-detail-back"
          onClick={onBack}
          className={SECONDARY_ACTION_CLASS}
        >
          <ArrowLeft aria-hidden className="size-4" />
          {backLabel}
        </button>
        <a
          href={CHAT_WITH_PERSON_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="watch-end-reflection-talk-submit"
          className={PRIMARY_ACTION_CLASS}
        >
          <HeartHandshake aria-hidden className="size-4" />
          {title}
        </a>
      </div>
    </div>
  )
}

function ShareView({
  title,
  detail,
  backLabel,
  onBack,
  onShare,
}: {
  title: string
  detail: string
  backLabel: string
  onBack: () => void
  onShare: () => void
}) {
  return (
    <div
      data-testid="watch-end-reflection-share-panel"
      className="animate-watch-reflection-enter motion-reduce:animate-none"
    >
      <DetailHeader
        icon={<Share2 aria-hidden className="size-6" />}
        title={title}
        detail={detail}
      />
      <div className="mt-8 flex items-center gap-4" aria-hidden="true">
        <span className="grid size-14 place-items-center rounded-full border border-white/15 bg-white/[0.07]">
          <UserRound className="size-6 text-white/70" />
        </span>
        <span className="h-px w-12 bg-gradient-to-r from-brand-red to-white/20" />
        <span className="grid size-14 place-items-center rounded-full bg-brand-red text-white">
          <Share2 className="size-6" />
        </span>
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="watch-end-reflection-detail-back"
          onClick={onBack}
          className={SECONDARY_ACTION_CLASS}
        >
          <ArrowLeft aria-hidden className="size-4" />
          {backLabel}
        </button>
        <button
          type="button"
          data-testid="watch-end-reflection-share-submit"
          onClick={onShare}
          className={PRIMARY_ACTION_CLASS}
        >
          <Share2 aria-hidden className="size-4" />
          {title}
        </button>
      </div>
    </div>
  )
}
