"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import type { RefObject } from "react"
import { useCallback } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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

  const playable = variants.filter(
    (v) => v.published === true && v.hls != null && v.language?.slug != null,
  )

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  const handleSelect = useCallback(
    (slug: string) => {
      if (slug === currentLanguageSlug) {
        onClose()
        return
      }
      const t = playerRef.current?.currentTime ?? 0
      // basePath '/watch' auto-prepended at runtime — do NOT include here.
      const href = `/${videoSlug}/${slug}?t=${t}` as Route
      router.push(href)
      onClose()
    },
    [currentLanguageSlug, onClose, playerRef, router, videoSlug],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-language-picker-modal"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Language</DialogTitle>
          <DialogDescription>
            Choose a language for this video.
          </DialogDescription>
        </DialogHeader>

        {playable.length === 0 ? (
          <p
            data-testid="watch-language-picker-empty"
            className="text-sm text-muted-foreground"
          >
            No additional languages are available for this video.
          </p>
        ) : (
          <ul
            data-testid="watch-language-picker-options"
            className="flex max-h-80 flex-col gap-1 overflow-y-auto"
          >
            {playable.map((variant) => {
              const slug = variant.language?.slug ?? ""
              const name = variant.language?.name ?? slug
              const active = slug === currentLanguageSlug
              return (
                <li key={variant.documentId}>
                  <button
                    type="button"
                    data-testid="watch-language-picker-option"
                    data-language-slug={slug}
                    data-active={active ? "true" : "false"}
                    onClick={() => handleSelect(slug)}
                    aria-current={active ? "true" : undefined}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-left text-sm font-semibold text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <span>{name}</span>
                    {active ? (
                      <span
                        data-testid="watch-language-picker-checkmark"
                        aria-hidden="true"
                        className="text-amber-400"
                      >
                        <CheckIcon />
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
