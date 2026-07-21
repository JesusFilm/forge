"use client"

import { ExternalLink, Loader2, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

const FEEDBACK_EMBED_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScNeD3kPs7bqhV2i_QA6IMRCrs9W638TJuApb6QA4_ezQAEPA/viewform?embedded=true"
const FEEDBACK_FALLBACK_URL = "https://forms.gle/8WddM1kuyEBznukW8"

type FeedbackModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReady?: () => void
}

export function FeedbackModal({
  open,
  onOpenChange,
  onReady,
}: FeedbackModalProps) {
  const t = useTranslations("Feedback")
  const [iframeLoaded, setIframeLoaded] = useState(false)

  useEffect(() => {
    onReady?.()
  }, [onReady])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="feedback-modal"
        overlayClassName="z-[70] bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
        className="z-[71] flex h-dvh w-dvw max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-stone-950 p-0 text-stone-100 ring-0 sm:h-[min(90dvh,900px)] sm:w-[min(92vw,760px)] sm:max-w-[760px] sm:rounded-2xl sm:ring-1 sm:ring-white/15"
      >
        <header className="relative shrink-0 border-b border-white/10 px-5 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-4 pr-16 sm:px-6 sm:pt-5 sm:pr-20">
          <DialogTitle className="text-xl leading-tight font-semibold text-white sm:text-2xl">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="mt-1.5 max-w-xl text-sm leading-relaxed text-stone-300">
            {t("description")}
          </DialogDescription>
          <a
            href={FEEDBACK_FALLBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="feedback-fallback-link"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-stone-200 underline decoration-stone-500 underline-offset-4 transition hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            {t("openInNewTab")}
            <ExternalLink aria-hidden className="size-4" />
          </a>
          <DialogClose
            aria-label={t("closeForm")}
            data-testid="feedback-modal-close"
            className="absolute top-[calc(.75rem+env(safe-area-inset-top,0px))] right-3 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-stone-200 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:top-4 sm:right-4"
          >
            <X aria-hidden className="size-6" />
          </DialogClose>
        </header>

        <div className="relative min-h-0 flex-1 bg-white pb-[env(safe-area-inset-bottom,0px)] sm:pb-0">
          {!iframeLoaded ? (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-x-0 top-0 bottom-[env(safe-area-inset-bottom,0px)] grid place-items-center bg-stone-950 text-stone-200 sm:bottom-0"
            >
              <div className="flex items-center gap-3 text-sm font-semibold">
                <Loader2 aria-hidden className="size-5 animate-spin" />
                {t("loadingGoogleForm")}
              </div>
            </div>
          ) : null}
          {open ? (
            <iframe
              src={FEEDBACK_EMBED_URL}
              title={t("iframeTitle")}
              loading="lazy"
              sandbox="allow-forms allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              onLoad={() => setIframeLoaded(true)}
              data-testid="feedback-form-iframe"
              className={`relative z-1 h-full w-full border-0 bg-white transition-opacity duration-200 ${iframeLoaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
