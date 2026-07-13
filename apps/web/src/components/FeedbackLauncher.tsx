"use client"

import dynamic from "next/dynamic"
import { MessageSquareText } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"

function FeedbackModalLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="feedback-modal-loading"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/85 px-6 text-center text-sm font-semibold text-white backdrop-blur-md"
    >
      Loading feedback form…
    </div>
  )
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
  const [requested, setRequested] = useState(false)
  const [open, setOpen] = useState(false)
  const [modalReady, setModalReady] = useState(false)
  const markModalReady = useCallback(() => setModalReady(true), [])

  useEffect(() => {
    if (!searchOpen) return
    const frame = window.requestAnimationFrame(() => setOpen(false))
    return () => window.cancelAnimationFrame(frame)
  }, [searchOpen])

  function openFeedback() {
    if (searchOpen) return
    setRequested(true)
    setOpen(true)
  }

  return (
    <>
      {!searchOpen ? (
        <button
          type="button"
          aria-label="Open feedback form"
          aria-busy={requested && open && !modalReady}
          data-testid="feedback-launcher"
          onClick={openFeedback}
          className="fixed top-1/2 right-[env(safe-area-inset-right,0px)] z-[46] inline-flex min-h-11 min-w-11 -translate-y-1/2 cursor-pointer items-center justify-center gap-2 rounded-l-full border border-r-0 border-white/15 bg-stone-950/90 px-3 py-3 text-sm font-semibold text-stone-100 shadow-2xl backdrop-blur-md transition-colors hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:px-4"
        >
          <MessageSquareText aria-hidden className="size-5 shrink-0" />
          <span className="sr-only sm:not-sr-only">Feedback</span>
        </button>
      ) : null}

      {requested && !searchOpen ? (
        <LazyFeedbackModal
          open={open}
          onOpenChange={setOpen}
          onReady={markModalReady}
        />
      ) : null}
    </>
  )
}
