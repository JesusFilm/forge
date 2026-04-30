"use client"

import { useState } from "react"

import { env } from "@/env"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Embed-snippet section was removed alongside the embed route — shipping a
// snippet that 404s would leak broken iframes onto partner sites.
export type ShareModalProps = {
  open: boolean
  videoSlug: string
  currentLanguageSlug: string
  onClose: () => void
}

type CopyStatus = "idle" | "copied" | "failed"

export function ShareModal({
  open,
  videoSlug,
  currentLanguageSlug,
  onClose,
}: ShareModalProps) {
  const [linkStatus, setLinkStatus] = useState<CopyStatus>("idle")

  // Includes `/watch/` because this is the externally-shareable absolute URL,
  // not a router.push target — basePath isn't auto-prepended on bare origins.
  const origin = env.NEXT_PUBLIC_CANONICAL_ORIGIN
  const canonicalUrl = `${origin}/watch/${videoSlug}/${currentLanguageSlug}`

  function handleOpenChange(next: boolean) {
    if (!next) {
      setLinkStatus("idle")
      onClose()
    }
  }

  async function copy(
    text: string,
    setter: (status: CopyStatus) => void,
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setter("copied")
    } catch {
      setter("failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="watch-share-modal" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            Copy a link to this video, or embed it on another site.
          </DialogDescription>
        </DialogHeader>

        <section
          data-testid="watch-share-modal-link"
          className="flex flex-col gap-2"
        >
          <label className="text-xs font-semibold uppercase tracking-widest text-stone-300">
            Copy link
          </label>
          {linkStatus === "failed" ? (
            <p
              data-testid="watch-share-modal-link-fallback"
              role="alert"
              className="text-xs text-amber-400"
            >
              Couldn’t copy automatically — select the link below and copy
              manually.
            </p>
          ) : null}
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              data-testid="watch-share-modal-link-input"
              readOnly
              value={canonicalUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            />
            <button
              type="button"
              data-testid="watch-share-modal-link-copy"
              onClick={() => copy(canonicalUrl, setLinkStatus)}
              className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-900 transition hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {linkStatus === "copied" ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
