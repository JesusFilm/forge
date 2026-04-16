"use client"

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
    <div className="collection-empty collection-empty--language-required">
      <span
        aria-hidden="true"
        className="collection-empty-illustration collection-empty-illustration--subtitles"
      />
      <span className="collection-empty-title">Select a language to begin</span>
      <span className="collection-empty-hint">
        Choose a language to view {reportLabel.toLowerCase()} coverage across
        the media library.
      </span>
      {presets.length > 0 ? (
        <div className="collection-empty-presets" aria-label="Language presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="collection-empty-preset"
              onClick={() => onSelectPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="collection-empty-browse"
        onClick={onBrowseAllLanguages}
      >
        Browse all languages
      </button>
    </div>
  )
}
