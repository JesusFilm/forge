import { Sparkles } from "lucide-react"

import type { QuizButtonSection } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type QuizButtonPreviewProps = {
  section: QuizButtonSection
}

export function QuizButtonPreview({ section }: QuizButtonPreviewProps) {
  return (
    <div className="flex justify-center py-2">
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-3",
          "bg-primary-500 font-medium text-white shadow-sm",
          "transition-colors hover:bg-primary-600",
        )}
      >
        <Sparkles className="h-4 w-4" />
        {section.buttonText}
      </button>
    </div>
  )
}
