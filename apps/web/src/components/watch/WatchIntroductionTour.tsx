"use client"

import {
  Clapperboard,
  Languages,
  MonitorSmartphone,
  Search,
  Triangle,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"

const VIEWPORT_MARGIN = 16
const TARGET_PADDING = 8
const CARD_GAP = 16
const MAX_CARD_WIDTH = 440
const ESTIMATED_CARD_HEIGHT = 260

const TARGET_SELECTORS = {
  search: '[data-testid="floating-search-desktop-button"]',
  language: '[data-testid="floating-header-language-button"]',
} as const

type StepKey = "discover" | "search" | "language" | "apps"
type TargetKey = keyof typeof TARGET_SELECTORS

type StepDefinition = {
  key: StepKey
  icon: LucideIcon
  target?: TargetKey
}

const STEPS: readonly StepDefinition[] = [
  { key: "discover", icon: Clapperboard },
  { key: "search", icon: Search, target: "search" },
  { key: "language", icon: Languages, target: "language" },
  { key: "apps", icon: MonitorSmartphone },
]

const STEP_COUNT = STEPS.length

type TargetLayout = {
  card: CSSProperties
  outline: CSSProperties
  arrowLeft: number
  placement: "above" | "below"
}

type MeasuredTargetLayout = TargetLayout & { target: TargetKey }

export type WatchIntroductionTourProps = {
  open: boolean
  onSkip: () => void
  onComplete: () => void
  onSignup: () => boolean
  finalFocus: false | RefObject<HTMLElement | null>
}

function useForcedColors() {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(forced-colors: active)")
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return matches
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function measureTarget(target: HTMLElement): TargetLayout | null {
  const rect = target.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const targetStyle = window.getComputedStyle(target)
  if (
    !target.isConnected ||
    target.hasAttribute("disabled") ||
    targetStyle.display === "none" ||
    targetStyle.visibility === "hidden" ||
    targetStyle.opacity === "0" ||
    rect.width < 24 ||
    rect.height < 24 ||
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= viewportWidth ||
    rect.top >= viewportHeight
  ) {
    return null
  }

  const cardWidth = Math.min(
    MAX_CARD_WIDTH,
    viewportWidth - VIEWPORT_MARGIN * 2,
  )
  const cardLeft = clamp(
    rect.left + rect.width / 2 - cardWidth / 2,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportWidth - cardWidth - VIEWPORT_MARGIN),
  )
  const canFitBelow =
    rect.bottom + CARD_GAP + ESTIMATED_CARD_HEIGHT <=
    viewportHeight - VIEWPORT_MARGIN
  const placement = canFitBelow ? "below" : "above"
  const cardTop =
    placement === "below"
      ? rect.bottom + CARD_GAP
      : Math.max(VIEWPORT_MARGIN, rect.top - CARD_GAP - ESTIMATED_CARD_HEIGHT)

  return {
    card: {
      left: `${Math.round(cardLeft)}px`,
      top: `max(${Math.round(cardTop)}px, calc(env(safe-area-inset-top, 0px) + ${VIEWPORT_MARGIN}px))`,
      width: `${Math.round(cardWidth)}px`,
      maxHeight: `calc(100dvh - max(${Math.round(cardTop)}px, calc(env(safe-area-inset-top, 0px) + ${VIEWPORT_MARGIN}px)) - max(${VIEWPORT_MARGIN}px, env(safe-area-inset-bottom, 0px)))`,
    },
    outline: {
      left: `${Math.round(Math.max(0, rect.left - TARGET_PADDING))}px`,
      top: `${Math.round(Math.max(0, rect.top - TARGET_PADDING))}px`,
      width: `${Math.round(
        Math.min(viewportWidth, rect.right + TARGET_PADDING) -
          Math.max(0, rect.left - TARGET_PADDING),
      )}px`,
      height: `${Math.round(
        Math.min(viewportHeight, rect.bottom + TARGET_PADDING) -
          Math.max(0, rect.top - TARGET_PADDING),
      )}px`,
    },
    arrowLeft: clamp(
      rect.left + rect.width / 2 - cardLeft,
      28,
      Math.max(28, cardWidth - 28),
    ),
    placement,
  }
}

export function WatchIntroductionTour({
  open,
  onSkip,
  onComplete,
  onSignup,
  finalFocus,
}: WatchIntroductionTourProps) {
  const t = useTranslations("WatchIntroductionTour")
  const [stepIndex, setStepIndex] = useState(0)
  const [targetLayout, setTargetLayout] = useState<MeasuredTargetLayout | null>(
    null,
  )
  const [signupUnavailable, setSignupUnavailable] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const completedActionRef = useRef(false)
  const forcedColors = useForcedColors()
  const step = STEPS[stepIndex] ?? STEPS[0]
  const isFinalStep = stepIndex === STEP_COUNT - 1

  useEffect(() => {
    if (open) completedActionRef.current = false
  }, [open])

  const finishOnce = useCallback((action: () => void) => {
    if (completedActionRef.current) return
    completedActionRef.current = true
    setSignupUnavailable(false)
    setStepIndex(0)
    setTargetLayout(null)
    action()
  }, [])
  const requestSkip = useCallback(
    () => finishOnce(onSkip),
    [finishOnce, onSkip],
  )
  const requestComplete = useCallback(
    () => finishOnce(onComplete),
    [finishOnce, onComplete],
  )
  const requestSignup = useCallback(() => {
    if (completedActionRef.current) return
    if (!onSignup()) {
      setSignupUnavailable(true)
      return
    }
    finishOnce(() => undefined)
  }, [finishOnce, onSignup])

  useEffect(() => {
    if (!open || forcedColors || step.target == null) return

    const targetKey = step.target
    const target = document.querySelector<HTMLElement>(
      TARGET_SELECTORS[targetKey],
    )
    if (!target) return

    const targetWasInert = target.inert
    target.inert = true
    let frame = 0
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const layout = measureTarget(target)
        setTargetLayout(layout ? { ...layout, target: targetKey } : null)
      })
    }
    update()
    window.addEventListener("resize", update, { passive: true })
    window.addEventListener("scroll", update, {
      passive: true,
      capture: true,
    })

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      if (!targetWasInert) target.inert = false
    }
  }, [forcedColors, open, step.target])

  const Icon = step.icon
  const activeTargetLayout =
    !forcedColors && step.target != null && targetLayout?.target === step.target
      ? targetLayout
      : null
  const targeted = activeTargetLayout != null
  const titleId = "watch-introduction-tour-title"
  const descriptionId = "watch-introduction-tour-description"

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestSkip()
      }}
    >
      <DialogContent
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="watch-introduction-tour"
        data-watch-tour-layout={targeted ? "targeted" : "centered"}
        data-forced-colors={String(forcedColors)}
        initialFocus={closeButtonRef}
        finalFocus={finalFocus}
        showCloseButton={false}
        overlayClassName={`${targeted ? "bg-transparent backdrop-blur-none supports-backdrop-filter:backdrop-blur-none" : "bg-black/82 backdrop-blur-[2px]"} motion-reduce:transition-none forced-colors:bg-black`}
        portalLayer={
          activeTargetLayout ? (
            <div
              aria-hidden="true"
              data-testid="watch-introduction-target-outline"
              className="pointer-events-none fixed z-[900] rounded-xl border border-red-500/80 bg-transparent shadow-[0_0_0_2px_rgba(239,68,68,0.14),0_0_18px_rgba(239,68,68,0.24),0_0_0_9999px_rgba(0,0,0,0.82)] motion-reduce:transition-none"
              style={activeTargetLayout.outline}
            />
          ) : null
        }
        viewportClassName={`pointer-events-none fixed inset-0 z-[1000] overflow-hidden p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] ${targeted ? "" : "grid place-items-center"}`}
        className={`pointer-events-auto z-[1070] max-h-[calc(100dvh-2rem)] max-w-[520px] gap-0 overflow-visible rounded-xl border border-white/10 bg-stone-950 p-0 text-start text-stone-100 shadow-[0_20px_60px_rgba(0,0,0,0.64)] ring-1 ring-white/8 motion-reduce:transition-none forced-colors:border forced-colors:border-white forced-colors:bg-black ${targeted ? "fixed" : "relative w-[min(520px,calc(100vw-2rem))]"}`}
        style={activeTargetLayout?.card}
      >
        {activeTargetLayout ? (
          <Triangle
            aria-hidden="true"
            data-testid="watch-introduction-arrow"
            className={`pointer-events-none absolute z-10 size-5 fill-stone-950 stroke-stone-950 ${
              activeTargetLayout.placement === "below"
                ? "-top-3.5"
                : "-bottom-3.5 rotate-180"
            }`}
            strokeWidth={2}
            style={{
              left: `${Math.round(activeTargetLayout.arrowLeft - 10)}px`,
            }}
          />
        ) : null}

        <WatchModalViewportCloseButton
          open={open}
          onClose={requestSkip}
          testId="watch-introduction-tour-close"
          buttonRef={closeButtonRef}
          ariaLabel={t("close")}
          renderInline
        />

        <div className="flex max-h-[inherit] min-h-0 flex-col gap-4 overflow-y-auto rounded-[inherit] px-5 py-5 sm:px-6 sm:py-6">
          <div
            className={`flex items-center gap-3 pe-10 ${targeted ? "justify-end" : "justify-between"}`}
          >
            {!targeted ? (
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-600/12 text-red-400 ring-1 ring-red-500/25 forced-colors:border">
                <Icon aria-hidden className="size-5" />
              </span>
            ) : null}
            <span
              aria-live="polite"
              aria-atomic="true"
              className="text-xs font-medium text-stone-400"
            >
              {t("progress", {
                current: stepIndex + 1,
                total: STEP_COUNT,
              })}
            </span>
          </div>

          <div className="min-w-0 space-y-2">
            {!targeted ? (
              <p className="text-[10px] font-bold tracking-[0.15em] text-red-400 uppercase">
                {t(`steps.${step.key}.eyebrow`)}
              </p>
            ) : null}
            <DialogTitle
              id={titleId}
              className="text-pretty text-2xl leading-tight font-bold text-white sm:text-[28px]"
            >
              {t(`steps.${step.key}.title`)}
            </DialogTitle>
            <DialogDescription
              id={descriptionId}
              className="max-w-[54ch] text-sm leading-relaxed text-stone-300 sm:text-[15px]"
            >
              {t(`steps.${step.key}.description`)}
            </DialogDescription>
            {isFinalStep && signupUnavailable ? (
              <p
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-amber-300"
              >
                {t("signupUnavailable")}
              </p>
            ) : null}
          </div>

          <div
            data-testid="watch-introduction-actions"
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            {!isFinalStep ? (
              <button
                type="button"
                onClick={requestSkip}
                className="min-h-10 rounded-full px-4 py-2 text-sm font-semibold text-stone-400 transition hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none motion-reduce:transition-none sm:me-auto"
              >
                {t("skip")}
              </button>
            ) : null}
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setStepIndex((current) => {
                    setSignupUnavailable(false)
                    return Math.max(0, current - 1)
                  })
                }
                className="min-h-10 rounded-full bg-white/8 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none motion-reduce:transition-none"
              >
                {t("back")}
              </button>
            ) : null}
            {isFinalStep ? (
              <button
                type="button"
                data-variant="secondary"
                onClick={requestComplete}
                className="min-h-10 rounded-full bg-white/8 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none motion-reduce:transition-none"
              >
                {t("done")}
              </button>
            ) : null}
            <button
              type="button"
              data-variant="primary"
              onClick={
                isFinalStep
                  ? requestSignup
                  : () =>
                      setStepIndex((current) =>
                        Math.min(STEP_COUNT - 1, current + 1),
                      )
              }
              className="min-h-10 rounded-full bg-white px-6 py-2 text-sm font-bold text-stone-950 transition hover:bg-red-500 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 focus-visible:outline-none motion-reduce:transition-none sm:min-w-28"
            >
              {isFinalStep ? t("signup") : t("next")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
