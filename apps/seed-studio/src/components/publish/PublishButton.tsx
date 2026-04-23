"use client"

import { useState } from "react"
import { ExternalLink, Save } from "lucide-react"

import type { GeneratedExperience } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

import { PublishDialog } from "./PublishDialog"

const WEB_BASE_URL =
  process.env.NEXT_PUBLIC_WEB_BASE_URL ?? "http://localhost:3000/watch"

type PublishButtonProps = {
  experience: GeneratedExperience | null
  savedSlug: string | null
  onSaved: (slug: string) => void
}

export function PublishButton({
  experience,
  savedSlug,
  onSaved,
}: PublishButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={!experience}
        className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-2",
          "border border-neutral-200 bg-white text-sm font-medium",
          "text-neutral-700 transition-colors hover:bg-neutral-50",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        <Save className="h-4 w-4" />
        Save to Strapi
      </button>

      <a
        href={savedSlug ? `${WEB_BASE_URL}/${savedSlug}` : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!savedSlug}
        onClick={(e) => {
          if (!savedSlug) e.preventDefault()
        }}
        className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-2",
          "bg-primary-500 text-sm font-medium text-white transition-colors",
          "hover:bg-primary-600",
          !savedSlug && "cursor-not-allowed opacity-40",
        )}
      >
        <ExternalLink className="h-4 w-4" />
        Preview
      </a>

      {experience && dialogOpen ? (
        <PublishDialog
          experience={experience}
          initialSlug={savedSlug ?? experience.slug ?? ""}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onPublished={(slug) => {
            onSaved(slug)
          }}
        />
      ) : null}
    </>
  )
}
