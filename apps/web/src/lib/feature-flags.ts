import "server-only"

import {
  createFeatureFlagClient,
  featureFlags,
  type FeatureFlagContext,
} from "@forge/feature-flags"

import { env, resolveUserPlaylistUxControls } from "@/env"

export type WebFeatureFlagContextInput = Partial<FeatureFlagContext> & {
  custom?: FeatureFlagContext["custom"]
}

const webFeatureFlagClient = createFeatureFlagClient({
  sdkKey: env.LAUNCHDARKLY_SDK_KEY,
  localEnv: {
    FORGE_WATCH_PLAYER_MIGRATION_DEFAULT:
      env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT ??
      String(env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION),
    FORGE_WATCH_CTA_TEXT_COPY_DEFAULT: env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT,
    FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT:
      env.FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT,
    FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT:
      env.FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT,
    FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT:
      env.FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT,
    FORGE_WATCH_QUESTION_PANEL_DEFAULT: env.FORGE_WATCH_QUESTION_PANEL_DEFAULT,
    FORGE_USER_PLAYLIST_AUTHORING_DEFAULT:
      env.FORGE_USER_PLAYLIST_AUTHORING_DEFAULT,
    FORGE_USER_PLAYLIST_PUBLIC_READ_DEFAULT:
      env.FORGE_USER_PLAYLIST_PUBLIC_READ_DEFAULT,
  },
  defaultValues: {
    "forge.watch.playerMigration": env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION,
    "forge.watch.ctaTextCopy": false,
    "forge.watch.downloadAccountGate": false,
    "forge.watch.globalBetaTesterCta": false,
    "forge.watch.hideBibleQuotes": false,
    "forge.watch.questionPanel": false,
    "forge.userPlaylist.authoring": false,
    "forge.userPlaylist.publicRead": false,
  },
  timeoutSeconds: 0.25,
  logger: console,
})

export const watchDownloadAccountGateFlagContext = {
  custom: {
    surface: "watch-download",
  },
} satisfies WebFeatureFlagContextInput

export function createWebFeatureFlagContext(
  input: WebFeatureFlagContextInput = {},
): FeatureFlagContext {
  return {
    kind: input.kind ?? "service",
    key: input.key ?? "forge-web",
    name: input.name ?? "Forge Web",
    email: input.email,
    anonymous: input.anonymous,
    custom: {
      app: "web",
      canonicalOrigin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
      ...input.custom,
    },
  }
}

export async function isWatchPlayerMigrationEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  return webFeatureFlagClient.booleanVariation(
    featureFlags.watchPlayerMigration,
    createWebFeatureFlagContext(context),
  )
}

export async function isWatchCtaTextCopyEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  return webFeatureFlagClient.booleanVariation(
    featureFlags.watchCtaTextCopy,
    createWebFeatureFlagContext(context),
  )
}

export async function isWatchDownloadAccountGateEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  return webFeatureFlagClient.booleanVariation(
    featureFlags.watchDownloadAccountGate,
    createWebFeatureFlagContext(context),
  )
}

export async function isWatchGlobalBetaTesterCtaEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  return webFeatureFlagClient.booleanVariation(
    featureFlags.watchGlobalBetaTesterCta,
    createWebFeatureFlagContext(context),
  )
}

export async function isWatchHideBibleQuotesEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  return webFeatureFlagClient.booleanVariation(
    featureFlags.watchHideBibleQuotes,
    createWebFeatureFlagContext(context),
  )
}

export async function isWatchQuestionPanelEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  return webFeatureFlagClient.booleanVariation(
    featureFlags.watchQuestionPanel,
    createWebFeatureFlagContext(context),
  )
}

export async function isUserPlaylistAuthoringUxEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  if (resolveUserPlaylistUxControls().malformed) return false
  return webFeatureFlagClient.booleanVariation(
    featureFlags.userPlaylistAuthoring,
    createWebFeatureFlagContext(context),
  )
}

export async function isUserPlaylistPublicReadUxEnabled(
  context: WebFeatureFlagContextInput = {},
): Promise<boolean> {
  const controls = resolveUserPlaylistUxControls()
  if (controls.malformed || controls.emergencyPublicReadDisabled) return false
  return webFeatureFlagClient.booleanVariation(
    featureFlags.userPlaylistPublicRead,
    createWebFeatureFlagContext(context),
  )
}
