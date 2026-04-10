import { cn } from "@/lib/cn"

type SuggestionChipsProps = {
  suggestions: string[]
  onSelect: (suggestion: string) => void
}

export function SuggestionChips({
  suggestions,
  onSelect,
}: SuggestionChipsProps) {
  if (suggestions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className={cn(
            "cursor-pointer rounded-full border border-primary-200 px-3 py-1.5",
            "bg-primary-50 text-sm text-primary-700",
            "transition-colors hover:bg-primary-100",
          )}
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}
