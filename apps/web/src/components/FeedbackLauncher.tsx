"use client"

import dynamic, { type DynamicOptionsLoadingProps } from "next/dynamic"
import { useTranslations } from "next-intl"
import { Headset, Loader2 } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

import { useFeedbackLauncherIntro } from "@/components/useFeedbackLauncherIntro"
import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { buttonVariants } from "@/components/ui/button-variants"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"
import type { FeedbackCategory } from "@/lib/feedback"
import {
  reportFeedbackAbandoned,
  reportFeedbackOpened,
  type FeedbackAbandonReason,
  type FeedbackOpenSource,
  type FeedbackProgress,
} from "@/lib/feedback-analytics"
import { WATCH_FEEDBACK_OPEN_EVENT } from "@/lib/watch-feedback-events"
import { cn } from "@/lib/utils"

const FeedbackLoadingCancelContext = createContext<() => void>(() => {})

type FeedbackLoadNoticeProps = DynamicOptionsLoadingProps & {
  onCancel: () => void
}

export function FeedbackLoadNotice({
  error,
  retry,
  onCancel,
}: FeedbackLoadNoticeProps) {
  const t = useTranslations("Feedback")
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      data-testid="feedback-modal-loading"
      className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] left-[calc(1rem+env(safe-area-inset-left,0px))] z-[46] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-stone-950/95 p-4 pt-16 text-base sm:text-sm text-stone-100 shadow-2xl backdrop-blur-md"
    >
      <WatchModalViewportCloseButton
        open
        onClose={onCancel}
        testId="feedback-modal-close"
        ariaLabel={t("closeForm")}
      />
      <div className="flex items-start gap-3">
        {!error ? (
          <Loader2
            aria-hidden
            className="mt-0.5 size-5 shrink-0 animate-spin"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {error ? t("couldNotLoad") : t("loadingForm")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {error && retry ? (
              <button
                type="button"
                onClick={retry}
                className="cursor-pointer font-semibold underline decoration-stone-500 underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                {t("retry")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer font-semibold underline decoration-stone-500 underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeedbackModalLoading(props: DynamicOptionsLoadingProps) {
  const onCancel = useContext(FeedbackLoadingCancelContext)
  return <FeedbackLoadNotice {...props} onCancel={onCancel} />
}

const LazyFeedbackModal = dynamic(
  () =>
    import("@/components/FeedbackModal").then((module) => ({
      default: module.FeedbackModal,
    })),
  { loading: FeedbackModalLoading },
)

export function FeedbackLauncher() {
  const t = useTranslations("Feedback")
  const { searchOpen } = useFloatingSearchPinned()
  const introducing = useFeedbackLauncherIntro()
  const [open, setOpen] = useState(false)
  // Latches on the first open and never clears — see the mount note below.
  const [hasOpened, setHasOpened] = useState(false)
  const [modalReady, setModalReady] = useState(false)
  useWatchModalActivity(open)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const markModalReady = useCallback(() => setModalReady(true), [])

  /*
   * The funnel's close half lives here rather than in the modal, because the
   * modal never learns WHY it closed — a dismissal and global search taking
   * over look identical from inside it. This ref carries the modal's
   * published progress out to the component that does know.
   *
   * (The modal itself now stays mounted across a close, so its own state
   * survives; what it still cannot see is the reason.)
   *
   * `open` is tracked inside the ref, not read from state, so the report is
   * emitted exactly once per session: two close paths can race (a dismissal
   * landing in the same frame as global search taking over) and a state read
   * would be stale in at least one of them.
   */
  const sessionRef = useRef({
    open: false,
    step: 1,
    category: null as FeedbackCategory | null,
    submitted: false,
  })

  const handleProgress = useCallback((progress: Partial<FeedbackProgress>) => {
    sessionRef.current = { ...sessionRef.current, ...progress }
  }, [])

  const endSession = useCallback((reason: FeedbackAbandonReason) => {
    const session = sessionRef.current
    if (!session.open) return
    sessionRef.current = { ...session, open: false }
    if (session.submitted) return
    reportFeedbackAbandoned({
      step: session.step,
      category: session.category,
      reason,
    })
  }, [])

  const closeFeedback = useCallback(() => {
    endSession("dismissed")
    setOpen(false)
    if (searchOpen) return
    window.requestAnimationFrame(() => launcherRef.current?.focus())
  }, [endSession, searchOpen])
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => (nextOpen ? setOpen(true) : closeFeedback()),
    [closeFeedback],
  )

  useEffect(() => {
    if (!searchOpen) return
    const frame = window.requestAnimationFrame(() => {
      // Global search taking precedence is still an abandonment, but the
      // product caused it — worth telling apart from a deliberate dismissal.
      endSession("search_opened")
      setOpen(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [endSession, searchOpen])

  const openFeedback = useCallback(
    (source: FeedbackOpenSource) => {
      if (searchOpen) return
      // A second open while already open would double-count the funnel's
      // entry and reset the progress the abandonment report reads.
      if (sessionRef.current.open) return
      sessionRef.current = {
        open: true,
        step: 1,
        category: null,
        submitted: false,
      }
      reportFeedbackOpened({ source })
      setHasOpened(true)
      setOpen(true)
    },
    [searchOpen],
  )

  const openFromLauncher = useCallback(
    () => openFeedback("launcher"),
    [openFeedback],
  )
  const openFromPageCta = useCallback(
    () => openFeedback("page_cta"),
    [openFeedback],
  )

  // Page-level CTAs (e.g. the /whats-new feedback invitation) open the same
  // composer without duplicating the modal. Re-registered whenever
  // `openFromPageCta` changes so the search-open precedence stays current.
  useEffect(() => {
    window.addEventListener(WATCH_FEEDBACK_OPEN_EVENT, openFromPageCta)
    return () =>
      window.removeEventListener(WATCH_FEEDBACK_OPEN_EVENT, openFromPageCta)
  }, [openFromPageCta])

  return (
    <>
      {/* Shaped by the Watch download pill, not by a hand-rolled copy of
          it: the same `buttonVariants({ variant: "pill" })` +
          WATCH_PILL_BUTTON_CLASS pair the download CTA uses, so the two
          controls keep identical height, radius, type and hover treatment
          by construction rather than by two class strings that drift.
          That also settles the type tier — the pill is `text-xs` on every
          breakpoint, so the label fits the fixed box on phones too, where
          it is now visible (it used to reveal on hover only). */}
      {!searchOpen ? (
        <button
          ref={launcherRef}
          type="button"
          aria-label={t("openForm")}
          aria-busy={open && !modalReady}
          disabled={open && !modalReady}
          data-testid="feedback-launcher"
          data-feedback-ignore
          data-intro={introducing ? "visible" : "settled"}
          onClick={openFromLauncher}
          className={cn(
            buttonVariants({
              variant: "pill",
              className: WATCH_PILL_BUTTON_CLASS,
            }),
            "group fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-[calc(1rem+env(safe-area-inset-left,0px))] z-[46] shadow-2xl",
            // `gap-0` on purpose: a flex gap survives a zero-width child,
            // so a collapsed label would still push the icon off-centre.
            // The label carries its own animatable margin instead. The
            // `sm:` twin is load-bearing — tailwind-merge treats a
            // breakpoint-prefixed gap as a separate key, so `gap-0` alone
            // leaves the pill's `sm:gap-2` standing from `sm` up.
            "gap-0 overflow-hidden sm:gap-0",
            "animate-feedback-launcher-in transition-[padding,background-color,color,transform] duration-300 ease-out active:scale-95 motion-reduce:animate-none motion-reduce:transition-none",
            introducing
              ? null
              : // Settled: horizontal padding shrinks to exactly half the
                // gap between the pill's height and its icon, so the
                // button lands as a circle as tall as the download pill
                // instead of a stadium. Measured, not assumed — the pill
                // is 34px tall on phones and 46px from `sm` (padding plus
                // the 16px label line box plus the variant's 2px
                // transparent border), around a 16px icon: the base
                // variant's `[&_svg:not([class*='size-'])]:size-4`
                // outranks WATCH_PILL_BUTTON_CLASS's `[&_svg]:size-3.5`
                // on specificity for a lucide icon, on this launcher and
                // on the download CTA alike. So (34-2-16)/2 = 8 and
                // (46-2-16)/2 = 14. Hover and focus restore the pill's
                // own padding — which is why this animates padding and
                // not width: an auto-width box has no width to
                // interpolate.
                "px-2 hover:px-3 focus-visible:px-3 sm:px-3.5 sm:hover:px-5 sm:focus-visible:px-5",
          )}
        >
          <Headset aria-hidden className="shrink-0" />
          <span
            aria-hidden
            data-testid="feedback-launcher-label"
            className={cn(
              // Clipped by the button's `overflow-hidden`. `max-w` is the
              // animatable stand-in for the intrinsic width the text
              // actually needs — generous enough for the longest UI
              // locale, and the button's auto width tracks it frame by
              // frame as it closes.
              "ml-1.5 max-w-[16rem] shrink-0 overflow-hidden whitespace-nowrap opacity-100 transition-[max-width,opacity,margin,transform] duration-300 ease-out sm:ml-2 motion-reduce:transition-none",
              introducing
                ? null
                : // `sm:ml-0` next to `ml-0` for the same reason the button
                  // needs `sm:gap-0`: tailwind-merge keeps a
                  // breakpoint-prefixed margin as its own key, so `ml-0`
                  // alone leaves `sm:ml-2` standing and the settled button
                  // measures 8px wider than it is tall.
                  "ml-0 max-w-0 -translate-x-1 opacity-0 group-hover:ml-1.5 group-hover:max-w-[16rem] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[16rem] group-focus-visible:translate-x-0 group-focus-visible:opacity-100 sm:ml-0 sm:group-hover:ml-2 sm:group-focus-visible:ml-2",
            )}
          >
            {t("label")}
          </span>
        </button>
      ) : null}

      {/* Mounted from the first open onwards rather than torn down on close.
          Unmounting discarded every field the reporter had typed, so one
          stray Escape cost them the whole report. The sessionStorage draft is
          the durable half of that fix; this is the half that also covers a
          reader whose storage is denied or full. */}
      {hasOpened ? (
        <FeedbackLoadingCancelContext.Provider value={closeFeedback}>
          <LazyFeedbackModal
            open={open && !searchOpen}
            onOpenChange={handleOpenChange}
            onReady={markModalReady}
            onProgress={handleProgress}
          />
        </FeedbackLoadingCancelContext.Provider>
      ) : null}
    </>
  )
}
