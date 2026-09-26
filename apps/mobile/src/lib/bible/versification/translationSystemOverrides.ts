// Hand overrides for translationSystems.generated.ts (KTD6). The build script
// applies them after the classifier, so they win. The app never imports this
// file; review each change with the generated table in the pull request.
import type { StandardSystemId } from "./compact"

export type TranslationSystemOverride = {
  system: StandardSystemId
  /** One line: why the classifier result is wrong for this book. */
  reason: string
}

/** Translation id, then USFM book id, then the system to use. */
export const TRANSLATION_SYSTEM_OVERRIDES: Readonly<
  Record<string, Readonly<Record<string, TranslationSystemOverride>>>
> = {
  dan_det: {
    JOL: {
      system: "org",
      reason:
        "org with chapters 3-4 joined, which no system has; org gets BSB 2:28-32 right.",
    },
  },
}
