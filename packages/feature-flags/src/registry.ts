export const featureFlags = {
  watchPlayerMigration: {
    key: "forge.watch.playerMigration",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_PLAYER_MIGRATION_DEFAULT",
    description:
      "Runtime rollout gate for the web inline watch player migration.",
  },
  watchCtaTextCopy: {
    key: "forge.watch.ctaTextCopy",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_CTA_TEXT_COPY_DEFAULT",
    description:
      "Temporary production smoke flag for the watch-page CTA text copy.",
  },
  watchGlobalBetaTesterCta: {
    key: "forge.watch.globalBetaTesterCta",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT",
    description: "Temporary release flag for the global Watch beta tester CTA.",
  },
  watchDownloadAccountGate: {
    key: "forge.watch.downloadAccountGate",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT",
    description:
      "Runtime rollout gate for requiring a Web account before Watch downloads.",
  },
  watchYouVersionBibleQuotes: {
    key: "forge.watch.youVersionBibleQuotes",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT",
    description:
      "Runtime rollout gate for the watch-page YouVersion Bible Quotes panel.",
  },
  watchHideBibleQuotes: {
    key: "forge.watch.hideBibleQuotes",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT",
    description:
      "Runtime rollout gate for hiding the watch-page Bible Quotes section.",
  },
  watchQuestionPanel: {
    key: "forge.watch.questionPanel",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_QUESTION_PANEL_DEFAULT",
    description:
      "Runtime rollout gate for the watch-page floating question panel.",
  },
  watchAlgoliaSearch: {
    key: "forge.watch.algoliaSearch",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT",
    description:
      "Runtime rollout gate for Algolia-backed video results in the Forge watch search modal.",
  },
} as const

export type FeatureFlagName = keyof typeof featureFlags
export type FeatureFlagDefinition =
  (typeof featureFlags)[keyof typeof featureFlags]
export type FeatureFlagKey = FeatureFlagDefinition["key"]

export type FeatureFlagEnv = Record<string, string | undefined>

export type BooleanOverrideParseResult =
  | { ok: true; value: boolean }
  | { ok: false; reason: "empty" | "invalid" }

export function parseBooleanOverride(
  value: string | undefined,
): BooleanOverrideParseResult {
  if (value == null) return { ok: false, reason: "empty" }

  const normalized = value.trim().toLowerCase()
  if (!normalized) return { ok: false, reason: "empty" }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return { ok: true, value: true }
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return { ok: true, value: false }
  }

  return { ok: false, reason: "invalid" }
}

export function resolveLocalBooleanFallback(
  flag: FeatureFlagDefinition,
  env: FeatureFlagEnv,
  defaultValues: Partial<Record<FeatureFlagKey, boolean>> = {},
): boolean {
  const parsed = parseBooleanOverride(env[flag.localOverrideEnv])
  if (parsed.ok) return parsed.value
  return defaultValues[flag.key] ?? flag.defaultValue
}
