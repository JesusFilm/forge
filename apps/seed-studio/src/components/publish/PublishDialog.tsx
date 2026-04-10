"use client"

import { useCallback, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react"

import type { GeneratedExperience } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type PublishDialogProps = {
  experience: GeneratedExperience
  open: boolean
  onClose: () => void
  onPublished: () => void
}

type PublishState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; documentId: string }
  | { status: "error"; message: string }

export function PublishDialog({
  experience,
  open,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const [slug, setSlug] = useState(experience.slug)
  const [publishState, setPublishState] = useState<PublishState>({
    status: "idle",
  })

  const handlePublish = useCallback(async () => {
    setPublishState({ status: "loading" })
    try {
      const { publishExperience } = await import("@/app/actions/publish")
      const result = await publishExperience({
        ...experience,
        slug,
      })
      if (result.success) {
        setPublishState({
          status: "success",
          documentId: result.documentId ?? "",
        })
        onPublished()
      } else {
        setPublishState({
          status: "error",
          message: result.error ?? "Failed to publish",
        })
      }
    } catch (err) {
      setPublishState({
        status: "error",
        message: err instanceof Error ? err.message : "An error occurred",
      })
    }
  }, [experience, slug, onPublished])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close dialog"
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-md rounded-xl border border-neutral-200",
          "bg-white p-6 shadow-xl",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-3 top-3 flex h-8 w-8 items-center justify-center",
            "rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600",
          )}
        >
          <X className="h-4 w-4" />
        </button>

        {publishState.status === "success" ? (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-neutral-900">
                Published!
              </h3>
              <p className="text-sm text-neutral-500">
                Your experience is now live.
              </p>
            </div>
            {publishState.documentId ? (
              <p className="text-xs text-neutral-400">
                Document ID: {publishState.documentId}
              </p>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "inline-block rounded-lg bg-primary-500 px-4 py-2",
                "text-sm font-medium text-white transition-colors",
                "hover:bg-primary-600",
              )}
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-neutral-900">
                Publish to Strapi
              </h3>
              <p className="text-sm text-neutral-500">
                Review the details before publishing your experience.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="slug-input"
                  className="text-xs font-medium text-neutral-600"
                >
                  Slug
                </label>
                <input
                  id="slug-input"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className={cn(
                    "w-full rounded-lg border border-neutral-200 px-3 py-2",
                    "text-sm text-neutral-900 outline-none",
                    "focus:border-primary-300 focus:ring-2 focus:ring-primary-100",
                  )}
                />
              </div>

              <div className="flex gap-4 text-xs text-neutral-500">
                <span>
                  {experience.blocks.length}{" "}
                  {experience.blocks.length === 1 ? "section" : "sections"}
                </span>
                <span>Locale: en</span>
              </div>
            </div>

            {publishState.status === "error" ? (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-lg border border-red-200",
                  "bg-red-50 p-3",
                )}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm text-red-700">{publishState.message}</p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  "flex-1 rounded-lg border border-neutral-200 px-4 py-2",
                  "text-sm font-medium text-neutral-700 transition-colors",
                  "hover:bg-neutral-50",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishState.status === "loading" || !slug.trim()}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2",
                  "bg-primary-500 text-sm font-medium text-white transition-colors",
                  "hover:bg-primary-600",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {publishState.status === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Publishing...
                  </>
                ) : publishState.status === "error" ? (
                  "Retry"
                ) : (
                  "Publish"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
