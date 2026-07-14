"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
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

type ActionKind = "ask" | "talk" | "share" | "link" | "callback"

type NextStepAction = {
  id: string
  kind: ActionKind
  icon: ReactNode
  label: string
  detail: string
  href?: string
  onClick?: () => void
  testId: string
}

const CHAPTER_DURATION_MS = 5_000
const INACTIVITY_RESUME_MS = 6_000

const PRIMARY_ACTION_CLASS =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-red px-5 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:scale-[1.035] hover:bg-brand-red/90 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none motion-reduce:transform-none"
const STEP_ACTION_CLASS =
  "group relative flex min-h-20 w-full min-w-0 cursor-pointer flex-row items-center gap-3 overflow-hidden rounded-xl border px-3 pt-4 pb-3 text-left text-white transition-[background-color,border-color,opacity,transform] duration-300 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none motion-reduce:transition-none"

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
  const chapterListRef = useRef<HTMLOListElement>(null)
  const cleanedPrompts = prompts.filter((prompt) => prompt.trim().length > 0)
  const reflectionPrompts = (
    cleanedPrompts.length > 0
      ? cleanedPrompts
      : [tStudyQuestions("placeholderQuestion")]
  ).slice(0, 3)
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const [activeIndex, setActiveIndex] = useState(0)
  const [isGuiding, setIsGuiding] = useState(!reducedMotion)
  const [interactionVersion, setInteractionVersion] = useState(0)
  const [customQuestion, setCustomQuestion] = useState("")

  const resetStory = () => {
    setActiveIndex(0)
    setIsGuiding(!reducedMotion)
    setInteractionVersion(0)
    setCustomQuestion("")
  }

  const actions: NextStepAction[] = [
    {
      id: "ask",
      kind: "ask",
      icon: <MessageCircleHeart aria-hidden className="size-5" />,
      label: t("askBibleQuestion"),
      detail: t("askBibleQuestionDetail"),
      href: ASK_BIBLE_QUESTION_URL,
      testId: "watch-end-reflection-ask-bible",
    },
    {
      id: "talk",
      kind: "talk",
      icon: <HeartHandshake aria-hidden className="size-5" />,
      label: t("talkToPerson"),
      detail: t("talkToPersonDetail"),
      href: CHAT_WITH_PERSON_URL,
      testId: "watch-end-reflection-talk-person",
    },
    ...(onShare
      ? [
          {
            id: "share",
            kind: "share" as const,
            icon: <Share2 aria-hidden className="size-5" />,
            label: t("share"),
            detail: t("shareDetail"),
            onClick: () => {
              resetStory()
              onShare()
            },
            testId: "watch-end-reflection-share",
          },
        ]
      : []),
    ...(bibleReadHref
      ? [
          {
            id: "read",
            kind: "link" as const,
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
      kind: "link",
      icon: <Sparkles aria-hidden className="size-5" />,
      label: t("goDeeper"),
      detail: t("goDeeperDetail"),
      href: JOIN_BIBLE_STUDY_URL,
      testId: "watch-end-reflection-go-deeper",
    },
    ...(onDownload
      ? [
          {
            id: "download",
            kind: "callback" as const,
            icon: <Download aria-hidden className="size-5" />,
            label: t("download"),
            detail: t("downloadDetail"),
            onClick: onDownload,
            testId: "watch-end-reflection-download",
          },
        ]
      : []),
    ...(onNext
      ? [
          {
            id: "next",
            kind: "callback" as const,
            icon: <Play aria-hidden className="size-4 fill-current" />,
            label: t("watchNext"),
            detail: t("watchNextDetail"),
            onClick: onNext,
            testId: "watch-end-reflection-next-watch",
          },
        ]
      : []),
  ]

  const activeAction = actions[Math.min(activeIndex, actions.length - 1)]!
  const finalActionId = actions.at(-1)!.id
  const finalActionOnClick = actions.at(-1)!.onClick

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      surfaceRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open || reducedMotion || !isGuiding) return
    const timeout = window.setTimeout(() => {
      if (activeIndex === actions.length - 1 && finalActionId === "next") {
        finalActionOnClick?.()
        return
      }
      setActiveIndex((current) => (current + 1) % actions.length)
    }, CHAPTER_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [
    actions.length,
    activeIndex,
    finalActionId,
    finalActionOnClick,
    isGuiding,
    open,
    reducedMotion,
  ])

  useEffect(() => {
    if (!open) return
    const activeChapter = chapterListRef.current?.querySelector<HTMLElement>(
      '[data-highlighted="true"]',
    )
    activeChapter?.scrollIntoView?.({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    })
  }, [activeIndex, open, reducedMotion])

  useEffect(() => {
    if (!open || reducedMotion || isGuiding || interactionVersion === 0) return
    const timeout = window.setTimeout(() => {
      setIsGuiding(true)
    }, INACTIVITY_RESUME_MS)
    return () => window.clearTimeout(timeout)
  }, [interactionVersion, isGuiding, open, reducedMotion])

  if (!open) return null

  const markInteraction = () => {
    if (reducedMotion) return
    setIsGuiding(false)
    setInteractionVersion((current) => current + 1)
  }

  const selectChapter = (index: number) => {
    markInteraction()
    setActiveIndex(index)
  }

  return (
    <div
      ref={surfaceRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="watch-end-reflection-title"
      data-testid="watch-end-reflection"
      tabIndex={-1}
      onPointerDownCapture={markInteraction}
      onInputCapture={markInteraction}
      onFocusCapture={(event) => {
        if (event.target !== event.currentTarget) markInteraction()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          resetStory()
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
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-black/90 text-white backdrop-blur-[14px] animate-overlay-fade-in focus:outline-none motion-reduce:animate-none"
    >
      <section
        data-testid="watch-end-reflection-content"
        className="relative mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-8 lg:px-12"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 pt-1">
            <p className="text-[10px] font-semibold tracking-[0.2em] text-white/45 uppercase sm:text-xs">
              {t("nextStepsEyebrow")}
            </p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/60 sm:text-sm">
              {t("nextStepsSupport")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("dismiss")}
            data-testid="watch-end-reflection-dismiss"
            onClick={() => {
              resetStory()
              onDismiss()
            }}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white/[0.07] text-white/75 transition hover:bg-white/[0.14] hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <nav
          aria-label={t("nextStepsTitle")}
          className="-mx-4 mt-4 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin] sm:-mx-8 sm:mt-6 sm:px-8 lg:-mx-12 lg:px-12"
        >
          <ol
            ref={chapterListRef}
            className="flex w-max min-w-full snap-x snap-mandatory gap-2"
          >
            {actions.map((action, index) => (
              <li
                key={action.id}
                className="w-[9.5rem] shrink-0 snap-start sm:w-[10.5rem] xl:min-w-[9.5rem] xl:flex-1"
              >
                <ChapterButton
                  action={action}
                  index={index}
                  active={index === activeIndex}
                  complete={index < activeIndex}
                  guiding={isGuiding}
                  onSelect={() => selectChapter(index)}
                />
              </li>
            ))}
          </ol>
        </nav>

        <main
          id="watch-end-reflection-stage"
          key={activeAction.id}
          aria-live="polite"
          onPointerEnter={markInteraction}
          data-testid="watch-end-reflection-panel"
          className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center py-8 sm:py-10 lg:py-12"
        >
          <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-white/45 uppercase">
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <span aria-hidden="true" className="text-white/20">
              /
            </span>
            <span>{String(actions.length).padStart(2, "0")}</span>
          </div>
          <ActionStage
            action={activeAction}
            prompts={reflectionPrompts}
            customQuestion={customQuestion}
            fieldLabel={tQuestionPanel("fieldLabel")}
            onQuestionChange={setCustomQuestion}
          />
        </main>

        <button
          type="button"
          data-testid="watch-end-reflection-replay"
          onClick={() => {
            resetStory()
            onReplay()
          }}
          className="min-h-11 w-fit cursor-pointer px-1 text-sm font-semibold text-white/65 underline decoration-white/30 underline-offset-4 transition hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
        >
          {t("replay")}
        </button>
      </section>
    </div>
  )
}

function ChapterButton({
  action,
  index,
  active,
  complete,
  guiding,
  onSelect,
}: {
  action: NextStepAction
  index: number
  active: boolean
  complete: boolean
  guiding: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={action.label}
      aria-current={active ? "step" : undefined}
      aria-controls="watch-end-reflection-stage"
      data-testid={action.testId}
      data-action-id={action.id}
      data-highlighted={active ? "true" : "false"}
      data-final-action={action.id === "next" ? "true" : "false"}
      className={`${STEP_ACTION_CLASS} ${
        active
          ? "scale-[1.02] border-white/25 bg-white/[0.12] opacity-100"
          : "border-white/[0.07] bg-white/[0.035] opacity-75 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.07] hover:opacity-100"
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-2 top-0 h-1 overflow-hidden rounded-full bg-white/15"
      >
        <span
          key={`${action.id}-${active}-${guiding}`}
          className={`block h-full origin-left rounded-full ${
            complete
              ? "scale-x-100 bg-white/55"
              : active
                ? guiding
                  ? "animate-watch-story-progress bg-brand-red"
                  : "scale-x-[0.1] bg-brand-red"
                : "scale-x-0 bg-white"
          }`}
        />
      </span>
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,transform] sm:size-9 ${
          active
            ? "animate-watch-story-icon bg-brand-red text-white"
            : "bg-white/10 text-white/75 group-hover:scale-105"
        }`}
      >
        {action.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[9px] font-semibold tracking-[0.12em] uppercase sm:text-[10px] ${
            active ? "text-white/70" : "text-white/35"
          }`}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className={`mt-0.5 line-clamp-2 min-h-[2.2em] text-[11px] leading-[1.1] font-semibold text-balance lg:text-xs ${
            active ? "text-white" : "text-white/80"
          }`}
        >
          {action.label}
        </span>
      </span>
    </button>
  )
}

function ActionStage({
  action,
  prompts,
  customQuestion,
  fieldLabel,
  onQuestionChange,
}: {
  action: NextStepAction
  prompts: string[]
  customQuestion: string
  fieldLabel: string
  onQuestionChange: (question: string) => void
}) {
  return (
    <>
      <div className="mt-5 grid size-12 place-items-center rounded-full bg-brand-red text-white animate-watch-story-icon sm:size-14 motion-reduce:animate-none">
        {action.icon}
      </div>
      <h2
        id="watch-end-reflection-title"
        className="mt-5 max-w-[17ch] text-[clamp(2.25rem,7vw,4.75rem)] leading-[0.96] font-semibold tracking-[-0.045em] text-balance animate-watch-story-copy motion-reduce:animate-none"
      >
        {action.label}
      </h2>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-white/65 animate-watch-story-detail sm:text-lg motion-reduce:animate-none">
        {action.detail}
      </p>

      {action.kind === "ask" ? (
        <AskChapter
          prompts={prompts}
          customQuestion={customQuestion}
          fieldLabel={fieldLabel}
          action={action}
          onQuestionChange={onQuestionChange}
        />
      ) : null}
      {action.kind === "talk" ? <TalkChapter action={action} /> : null}
      {action.kind === "share" ? <ShareChapter action={action} /> : null}
      {action.kind === "link" || action.kind === "callback" ? (
        <StageAction action={action} />
      ) : null}
    </>
  )
}

function StageAction({ action }: { action: NextStepAction }) {
  const content = (
    <>
      {action.label}
      {action.href ? (
        <ExternalLink aria-hidden className="size-4" />
      ) : (
        <ArrowRight aria-hidden className="size-4" />
      )}
    </>
  )

  if (action.href) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="watch-end-reflection-active-action"
        className={`${PRIMARY_ACTION_CLASS} mt-7 animate-watch-story-action motion-reduce:animate-none`}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      data-testid="watch-end-reflection-active-action"
      className={`${PRIMARY_ACTION_CLASS} mt-7 animate-watch-story-action motion-reduce:animate-none`}
    >
      {content}
    </button>
  )
}

function AskChapter({
  prompts,
  customQuestion,
  fieldLabel,
  action,
  onQuestionChange,
}: {
  prompts: string[]
  customQuestion: string
  fieldLabel: string
  action: NextStepAction
  onQuestionChange: (question: string) => void
}) {
  return (
    <div
      data-testid="watch-end-reflection-ask-panel"
      className="mt-6 max-w-2xl animate-watch-story-action motion-reduce:animate-none"
    >
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            data-testid="watch-end-reflection-suggested-question"
            onClick={() => onQuestionChange(prompt)}
            className="cursor-pointer rounded-full border border-white/14 bg-white/[0.05] px-3.5 py-2 text-left text-xs leading-snug text-white/72 transition hover:border-white/30 hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none sm:text-sm"
          >
            {prompt}
          </button>
        ))}
      </div>
      <label className="mt-4 block text-sm font-semibold text-white/65">
        <span>{fieldLabel}</span>
        <textarea
          value={customQuestion}
          onChange={(event) => onQuestionChange(event.target.value)}
          rows={2}
          data-testid="watch-end-reflection-question-input"
          className="mt-2 block min-h-20 w-full resize-y rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-base leading-relaxed text-white placeholder:text-white/35 focus:border-brand-red/80 focus:ring-2 focus:ring-brand-red/30 focus:outline-none"
        />
      </label>
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="watch-end-reflection-ask-submit"
        className={`${PRIMARY_ACTION_CLASS} mt-4`}
      >
        <SendHorizontal aria-hidden className="size-4" />
        {action.label}
      </a>
    </div>
  )
}

function TalkChapter({ action }: { action: NextStepAction }) {
  const languages = ["EN", "ES", "FR", "PT"]
  const languageNames = ["English", "Español", "Français", "Português"]

  return (
    <div
      data-testid="watch-end-reflection-talk-panel"
      className="mt-7 animate-watch-story-action motion-reduce:animate-none"
    >
      <div className="flex -space-x-2" aria-hidden="true">
        {languages.map((language) => (
          <span
            key={language}
            className="relative grid size-12 place-items-center rounded-full border-2 border-black bg-stone-800 text-white shadow-xl sm:size-14"
          >
            <UserRound className="size-6 text-white/80" />
            <span className="absolute right-0 bottom-0 rounded-full bg-brand-red px-1.5 py-0.5 text-[8px] font-bold tracking-wide">
              {language}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {languageNames.map((language) => (
          <span
            key={language}
            className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/65"
          >
            {language}
          </span>
        ))}
      </div>
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="watch-end-reflection-talk-submit"
        className={`${PRIMARY_ACTION_CLASS} mt-6`}
      >
        <HeartHandshake aria-hidden className="size-4" />
        {action.label}
      </a>
    </div>
  )
}

function ShareChapter({ action }: { action: NextStepAction }) {
  return (
    <div
      data-testid="watch-end-reflection-share-panel"
      className="mt-7 animate-watch-story-action motion-reduce:animate-none"
    >
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="grid size-11 place-items-center rounded-full bg-white/[0.08]">
          <UserRound className="size-5 text-white/65" />
        </span>
        <span className="h-px w-10 bg-gradient-to-r from-white/20 to-brand-red" />
        <span className="grid size-11 place-items-center rounded-full bg-brand-red text-white">
          <Share2 className="size-5" />
        </span>
      </div>
      <button
        type="button"
        data-testid="watch-end-reflection-share-submit"
        onClick={action.onClick}
        className={`${PRIMARY_ACTION_CLASS} mt-6`}
      >
        <Share2 aria-hidden className="size-4" />
        {action.label}
      </button>
    </div>
  )
}
