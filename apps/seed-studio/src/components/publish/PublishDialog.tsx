"use client"

import { useCallback, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react"

import type { GeneratedExperience } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type PublishDialogProps = {
  experience: GeneratedExperience
  initialSlug: string
  open: boolean
  onClose: () => void
  onPublished: (slug: string) => void
}

type PublishError = {
  message: string
  code?: string
  reason?: string
  suggestions?: string[]
}

type PublishState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; documentId: string; slug: string; warning?: string }
  | { status: "error"; error: PublishError }

export function PublishDialog({
  experience,
  initialSlug,
  open,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const [slug, setSlug] = useState(initialSlug)
  const [publishState, setPublishState] = useState<PublishState>({
    status: "idle",
  })

  const setSlugValue = useCallback((value: string) => {
    setSlug(value)
    setPublishState((current) =>
      current.status === "error" ? { status: "idle" } : current,
    )
  }, [])

  const applySuggestedSlug = useCallback((value: string) => {
    setSlug(value)
    setPublishState({ status: "idle" })
  }, [])

  const handlePublish = useCallback(async () => {
    setPublishState({ status: "loading" })
    try {
      const { publishExperience } = await import("@/app/actions/publish")
      const result = await publishExperience({
        ...experience,
        slug,
      })
      if (result.success) {
        setSlug(result.slug)
        setPublishState({
          status: "success",
          documentId: result.documentId,
          slug: result.slug,
          warning: result.warning,
        })
        onPublished(result.slug)
      } else {
        setPublishState({
          status: "error",
          error: result.error,
        })
      }
    } catch (err) {
      setPublishState({
        status: "error",
        error: {
          message: err instanceof Error ? err.message : "An error occurred",
        },
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
              <h3 className="text-lg font-semibold text-neutral-900">Saved!</h3>
              <p className="text-sm text-neutral-500">
                Your experience is saved in Strapi. Click Preview to see it on
                the web.
              </p>
            </div>
            {publishState.documentId ? (
              <div className="space-y-1 text-xs text-neutral-400">
                <p>Document ID: {publishState.documentId}</p>
                <p>Slug: {publishState.slug}</p>
              </div>
            ) : null}
            {publishState.warning ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-800">
                {publishState.warning}
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
                Save to Strapi
              </h3>
              <p className="text-sm text-neutral-500">
                Set a name (slug) for this experience before saving.
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
                  onChange={(e) => setSlugValue(e.target.value)}
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
                <div className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm text-red-700">
                    {publishState.error.message}
                  </p>
                  {publishState.error.suggestions &&
                  publishState.error.suggestions.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-red-700">
                        Try one of these slugs:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {publishState.error.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => applySuggestedSlug(suggestion)}
                            className={cn(
                              "rounded-full border border-red-200 bg-white px-3 py-1",
                              "text-xs font-medium text-red-700 transition-colors",
                              "hover:border-red-300 hover:bg-red-100",
                            )}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
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
                    Saving...
                  </>
                ) : publishState.status === "error" ? (
                  "Retry"
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
