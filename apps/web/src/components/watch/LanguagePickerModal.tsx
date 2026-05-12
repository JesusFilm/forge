"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import type { RefObject } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"

export type LanguagePickerVariant = {
  documentId: string
  hls: string | null
  published: boolean | null
  language: {
    coreId?: string | null
    slug: string | null
    name: string | null
  } | null
}

export type LanguagePickerModalProps = {
  open: boolean
  variants: LanguagePickerVariant[]
  currentLanguageSlug: string
  videoSlug: string
  /** Read `currentTime` for the `?t=` clamp on language switch. */
  playerRef: RefObject<MuxPlayerRef | null>
  onClose: () => void
}

export function LanguagePickerModal({
  open,
  variants,
  currentLanguageSlug,
  videoSlug,
  playerRef,
  onClose,
}: LanguagePickerModalProps) {
  const router = useRouter()

  const options = useMemo(
    () =>
      variants
        .filter(
          (v) =>
            v.published === true && v.hls != null && v.language?.slug != null,
        )
        .map((v) => ({
          slug: v.language!.slug!,
          name: v.language!.name ?? v.language!.slug!,
        })),
    [variants],
  )

  const [draftSlug, setDraftSlug] = useState(currentLanguageSlug)

  // Reset the draft each time the modal opens.
  useEffect(() => {
    if (open) setDraftSlug(currentLanguageSlug)
  }, [open, currentLanguageSlug])

  const isDirty = draftSlug !== currentLanguageSlug

  const handleApply = useCallback(() => {
    if (!isDirty) return
    // Write cookie BEFORE router.push — the order is asserted by tests and
    // matters for middleware: the cookie must be present before the navigation
    // lands on the new route.
    writePreferredLanguageSlug(draftSlug)
    const t = playerRef.current?.currentTime ?? 0
    // basePath '/watch' auto-prepended at runtime — do NOT include here.
    const href = `/${videoSlug}/${draftSlug}?t=${t}` as Route
    router.push(href)
    onClose()
  }, [draftSlug, isDirty, onClose, playerRef, router, videoSlug])

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-language-picker-modal"
        className="sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-baseline justify-between gap-3">
          <DialogTitle className="text-2xl font-bold">Language</DialogTitle>
          <span
            data-testid="watch-language-picker-count"
            className="text-sm text-stone-400"
          >
            {options.length} {options.length === 1 ? "language" : "languages"}
          </span>
        </DialogHeader>

        <div className="mt-4">
          <LanguageCombobox
            options={options}
            value={draftSlug}
            onChange={setDraftSlug}
          />
        </div>

        <div className="mt-8 flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="watch-language-picker-close"
            onClick={onClose}
            className="px-6 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-stone-300 transition hover:text-stone-100"
          >
            Close
          </button>
          <button
            type="button"
            data-testid="watch-language-picker-apply"
            disabled={!isDirty}
            onClick={handleApply}
            className="rounded-full bg-stone-100 px-6 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-stone-900 transition disabled:cursor-not-allowed disabled:bg-stone-500 disabled:text-stone-800"
          >
            Apply
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
