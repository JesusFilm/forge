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
    <div className="mx-auto flex min-h-[18rem] w-full max-w-[28rem] flex-col items-center justify-center px-4 py-6 text-center">
      <span className="text-[clamp(1.7rem,4vw,2.35rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-foreground">
        Select a language to begin
      </span>
      <span className="mt-3 max-w-[24rem] text-[clamp(0.95rem,2vw,1.12rem)] leading-[1.42] tracking-[-0.012em] text-muted-foreground">
        Choose a language to view {reportLabel.toLowerCase()} coverage across
        the media library.
      </span>
      {presets.length > 0 ? (
        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-2.5"
          aria-label="Language presets"
        >
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="md"
              className="rounded-full px-4"
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
        size="md"
        className="mt-4 rounded-full px-2 text-[0.875rem] font-semibold text-muted-foreground hover:text-foreground"
        onClick={onBrowseAllLanguages}
      >
        <Languages className="size-4.5" aria-hidden="true" />
        Browse all languages
        <ChevronRight className="size-4.5" aria-hidden="true" />
      </Button>
    </div>
  )
}
