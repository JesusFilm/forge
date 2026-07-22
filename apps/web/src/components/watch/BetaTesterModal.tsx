"use client"

import { useRef, useState, type RefObject } from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
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
  const handleClose = () => {
    setIframeLoaded(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return
        handleClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButtonRef}
        finalFocus={finalFocus}
        overlayClassName="bg-black/80 backdrop-blur-sm"
        viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-hidden"
        className="flex h-dvh w-dvw max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-stone-950 p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] text-white ring-0 sm:h-[min(88dvh,900px)] sm:w-[min(92vw,840px)] sm:max-w-none sm:rounded-2xl sm:pt-0 sm:pb-0 sm:ring-1 sm:ring-white/15"
      >
        <WatchModalViewportCloseButton
          open={open}
          onClose={handleClose}
          testId="beta-tester-modal-close"
          buttonRef={closeButtonRef}
          ariaLabel={t("close")}
        />
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4 pr-16 sm:px-6 sm:pr-20">
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
