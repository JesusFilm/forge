"use client"

import { useState } from "react"
import { Rocket } from "lucide-react"

import type { GeneratedExperience } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

import { PublishDialog } from "./PublishDialog"

type PublishButtonProps = {
  experience: GeneratedExperience | null
  onPublished?: () => void
}

export function PublishButton({ experience, onPublished }: PublishButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={!experience}
        className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-2",
          "bg-primary-500 text-sm font-medium text-white transition-colors",
          "hover:bg-primary-600",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        <Rocket className="h-4 w-4" />
        Publish to Strapi
      </button>
      {experience && dialogOpen ? (
        <PublishDialog
          experience={experience}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onPublished={() => {
            setDialogOpen(false)
            onPublished?.()
          }}
        />
      ) : null}
    </>
  )
}
