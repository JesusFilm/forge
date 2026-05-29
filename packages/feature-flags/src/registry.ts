export const featureFlags = {
  watchPlayerMigration: {
    key: "forge.watch.playerMigration",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_PLAYER_MIGRATION_DEFAULT",
    description:
      "Runtime rollout gate for the web inline watch player migration.",
  },
  watchHeroMuxVideo: {
    key: "forge.watch.heroMuxVideo",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT",
    description:
      "Runtime rollout gate for the web watch hero MuxVideo backend.",
  },
  watchCtaTextCopy: {
    key: "forge.watch.ctaTextCopy",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_CTA_TEXT_COPY_DEFAULT",
    description:
      "Temporary production smoke flag for the watch-page CTA text copy.",
  },
  watchQuestionPanel: {
    key: "forge.watch.questionPanel",
    defaultValue: false,
    localOverrideEnv: "FORGE_WATCH_QUESTION_PANEL_DEFAULT",
    description:
      "Runtime rollout gate for the watch-page floating question panel.",
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
