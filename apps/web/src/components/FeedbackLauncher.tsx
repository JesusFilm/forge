"use client"

import dynamic, { type DynamicOptionsLoadingProps } from "next/dynamic"
import { useTranslations } from "next-intl"
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react"
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
  const t = useTranslations("Feedback")
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      data-testid="feedback-modal-loading"
      className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] left-[calc(1rem+env(safe-area-inset-left,0px))] z-[46] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-stone-950/95 p-4 text-sm text-stone-100 shadow-2xl backdrop-blur-md"
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
            {error ? (
              <a
                href={FEEDBACK_FALLBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline decoration-stone-500 underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                {t("openFormShort")}
                <ExternalLink aria-hidden className="size-4" />
              </a>
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
          aria-label={t("openForm")}
          aria-busy={open && !modalReady}
          disabled={open && !modalReady}
          data-testid="feedback-launcher"
          onClick={openFeedback}
          className="group fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-[calc(1rem+env(safe-area-inset-left,0px))] z-[46] inline-flex h-11 w-11 cursor-pointer items-center justify-start overflow-hidden rounded-full border border-white/15 bg-stone-950/90 p-3 text-sm font-semibold text-stone-100 shadow-2xl backdrop-blur-md transition-[width,background-color,border-color,color] duration-200 ease-out hover:w-32 hover:border-brand-red/60 hover:bg-brand-red hover:text-white focus-visible:w-32 focus-visible:border-brand-red/60 focus-visible:bg-brand-red focus-visible:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        >
          <TriangleAlert aria-hidden className="size-5 shrink-0" />
          <span
            aria-hidden
            data-testid="feedback-launcher-label"
            className="ml-2 shrink-0 translate-x-1 whitespace-nowrap opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          >
            {t("label")}
          </span>
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
