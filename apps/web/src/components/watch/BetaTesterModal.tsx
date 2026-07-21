"use client"

import { useRef, useState, type RefObject } from "react"
import { ExternalLink, Loader2, X } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { BETA_TESTER_URL } from "@/lib/beta-tester"

export function BetaTesterModal({
  open,
  onClose,
  finalFocus,
}: {
  open: boolean
  onClose: () => void
  finalFocus: false | RefObject<HTMLElement | null>
}) {
  const t = useTranslations("BetaTesterModal")
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return
        setIframeLoaded(false)
        onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButtonRef}
        finalFocus={finalFocus}
        overlayClassName="bg-black/80 backdrop-blur-sm"
        className="top-0 left-0 flex h-dvh w-dvw max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-stone-950 p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] text-white ring-0 sm:top-1/2 sm:left-1/2 sm:h-[min(88dvh,900px)] sm:w-[min(92vw,840px)] sm:max-w-none sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pt-0 sm:pb-0 sm:ring-1 sm:ring-white/15"
      >
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4 pr-2 sm:px-6 sm:pr-3">
          <DialogTitle className="min-w-0 flex-1 text-base font-semibold text-white sm:text-lg">
            {t("title")}
          </DialogTitle>
          <a
            href={BETA_TESTER_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={t("openFormNewTab")}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-stone-200 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <span className="hidden sm:inline">{t("openFormNewTab")}</span>
            <ExternalLink aria-hidden className="h-4 w-4" />
          </a>
          <DialogClose
            ref={closeButtonRef}
            aria-label={t("close")}
            data-testid="beta-tester-modal-close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-300 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <X aria-hidden className="h-5 w-5" />
          </DialogClose>
        </header>
        <div className="relative min-h-0 flex-1 bg-white">
          {!iframeLoaded ? (
            <div className="absolute inset-0 z-20 grid place-items-center text-stone-700">
              <Loader2 aria-hidden className="h-8 w-8 animate-spin" />
              <span className="sr-only">{t("loading")}</span>
            </div>
          ) : null}
          <iframe
            src={BETA_TESTER_URL}
            title={t("iframeTitle")}
            sandbox="allow-forms allow-scripts allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setIframeLoaded(true)}
            className="relative z-10 h-full w-full border-0 bg-white"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
