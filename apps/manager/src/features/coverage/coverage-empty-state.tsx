"use client"

import { ChevronRight, Languages } from "lucide-react"
import { Button } from "@/components/ui/button"

import type { LanguagePreset } from "./language-selection"

export function LanguageSelectionEmptyState({
  reportLabel,
  presets,
  onSelectPreset,
  onBrowseAllLanguages,
}: {
  reportLabel: string
  presets: LanguagePreset[]
  onSelectPreset: (languageId: string) => void
  onBrowseAllLanguages: () => void
}) {
  return (
    <div className="mx-auto flex min-h-[32rem] w-full max-w-[42rem] flex-col items-center justify-center px-6 py-12 text-center">
      <span className="text-[clamp(2.25rem,6vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.05em] text-foreground">
        Select a language to begin
      </span>
      <span className="mt-6 max-w-[34rem] text-[clamp(1.25rem,3.4vw,2rem)] leading-[1.35] tracking-[-0.025em] text-muted-foreground">
        Choose a language to view {reportLabel.toLowerCase()} coverage across
        the media library.
      </span>
      {presets.length > 0 ? (
        <div
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
          aria-label="Language presets"
        >
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="lg"
              className="rounded-full px-7"
              onClick={() => onSelectPreset(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="mt-8 rounded-full px-4 text-[1.05rem] font-semibold text-muted-foreground hover:text-foreground"
        onClick={onBrowseAllLanguages}
      >
        <Languages className="size-5" aria-hidden="true" />
        Browse all languages
        <ChevronRight className="size-5" aria-hidden="true" />
      </Button>
    </div>
  )
}
