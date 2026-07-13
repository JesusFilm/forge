"use client"

import dynamic, { type DynamicOptionsLoadingProps } from "next/dynamic"
import { ExternalLink, Loader2, MessageSquareText } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"

const FEEDBACK_FALLBACK_URL = "https://forms.gle/8WddM1kuyEBznukW8"
const FeedbackLoadingCancelContext = createContext<() => void>(() => {})

type FeedbackLoadNoticeProps = DynamicOptionsLoadingProps & {
  onCancel: () => void
}

export function FeedbackLoadNotice({
  error,
  retry,
  onCancel,
}: FeedbackLoadNoticeProps) {
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      data-testid="feedback-modal-loading"
      className="fixed top-[calc(50%+3.5rem)] right-[calc(.75rem+env(safe-area-inset-right,0px))] z-[46] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-white/15 bg-stone-950/95 p-4 text-sm text-stone-100 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start gap-3">
        {!error ? (
          <Loader2
            aria-hidden
            className="mt-0.5 size-5 shrink-0 animate-spin"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {error ? "Feedback form could not load." : "Loading feedback form…"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {error && retry ? (
              <button
                type="button"
                onClick={retry}
                className="cursor-pointer font-semibold underline decoration-stone-500 underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                Retry
              </button>
            ) : null}
            {error ? (
              <a
                href={FEEDBACK_FALLBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline decoration-stone-500 underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                Open form
                <ExternalLink aria-hidden className="size-4" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer font-semibold underline decoration-stone-500 underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              Cancel
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
  const { searchOpen } = useFloatingSearchPinned()
  const [open, setOpen] = useState(false)
  const [modalReady, setModalReady] = useState(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const markModalReady = useCallback(() => setModalReady(true), [])

  const closeFeedback = useCallback(() => {
    setOpen(false)
    if (searchOpen) return
    window.requestAnimationFrame(() => launcherRef.current?.focus())
  }, [searchOpen])
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => (nextOpen ? setOpen(true) : closeFeedback()),
    [closeFeedback],
  )

  useEffect(() => {
    if (!searchOpen) return
    const frame = window.requestAnimationFrame(() => setOpen(false))
    return () => window.cancelAnimationFrame(frame)
  }, [searchOpen])

  function openFeedback() {
    if (searchOpen) return
    setOpen(true)
  }

  return (
    <>
      {!searchOpen ? (
        <button
          ref={launcherRef}
          type="button"
          aria-label="Open feedback form"
          aria-busy={open && !modalReady}
          disabled={open && !modalReady}
          data-testid="feedback-launcher"
          onClick={openFeedback}
          className="fixed top-1/2 right-[env(safe-area-inset-right,0px)] z-[46] inline-flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center gap-2 rounded-l-full border border-r-0 border-white/15 bg-stone-950/90 px-3 py-3 text-sm font-semibold text-stone-100 shadow-2xl backdrop-blur-md transition-colors hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:px-4"
        >
          <MessageSquareText aria-hidden className="size-5 shrink-0" />
          <span className="sr-only sm:not-sr-only">Feedback</span>
        </button>
      ) : null}

      {open && !searchOpen ? (
        <FeedbackLoadingCancelContext.Provider value={closeFeedback}>
          <LazyFeedbackModal
            open={open}
            onOpenChange={handleOpenChange}
            onReady={markModalReady}
          />
        </FeedbackLoadingCancelContext.Provider>
      ) : null}
    </>
  )
}
