"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import type { RefObject } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import { deriveLanguageDisplay } from "@/lib/language-display"
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

  // Per row, deriveLanguageDisplay decides whether Strapi's `name` is a
  // formatted-up English (use it verbatim, e.g. "A-Hmao", "Achi, Rabinal")
  // or the native form (slug-derived English as primary, name as subtitle,
  // e.g. "Adygey" / "Адыгэбзэ", "French" / "Français"). Sort by the primary
  // so the list stays A→Z by English form.
  const options = useMemo(
    () =>
      variants
        .filter(
          (v) =>
            v.published === true && v.hls != null && v.language?.slug != null,
        )
        .map((v) => deriveLanguageDisplay(v.language!.slug!, v.language!.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
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
    // Write cookie BEFORE router.push — order asserted by tests and required
    // so middleware sees the cookie on the next request.
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
        className="rounded-2xl border border-stone-700/50 bg-stone-900 p-0 text-stone-100 sm:max-w-xl"
        overlayClassName="bg-black/75"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Language</DialogTitle>

        <div className="flex items-baseline justify-between gap-3 border-b border-stone-700/50 px-6 py-4">
          <h2 className="text-lg font-semibold text-stone-50">Language</h2>
          <span
            data-testid="watch-language-picker-count"
            className="text-sm text-stone-400"
          >
            {options.length} {options.length === 1 ? "language" : "languages"}
          </span>
        </div>

        <div className="px-6 py-6">
          <LanguageCombobox
            options={options}
            value={draftSlug}
            onChange={setDraftSlug}
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-stone-700/50 px-6 py-4">
          <Button
            variant="ghost"
            data-testid="watch-language-picker-close"
            onClick={onClose}
            className="cursor-pointer rounded-full px-5 py-3.5 text-xs font-bold tracking-wider text-stone-300 uppercase transition-colors duration-200 hover:bg-transparent hover:text-stone-100"
          >
            Close
          </Button>
          <Button
            variant="pill"
            data-testid="watch-language-picker-apply"
            disabled={!isDirty}
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
