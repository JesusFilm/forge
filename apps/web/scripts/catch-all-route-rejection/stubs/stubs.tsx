import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTranslator } from "next-intl"
import { run, state } from "../control.ts"

export * from "../../../src/lib/watch-route-manifest.ts"

const english = JSON.parse(
  readFileSync(join(__dirname, "../../../messages/en.json"), "utf8"),
)

// next-intl/server: same shape as the real async getTranslations; success uses
// the real ICU translator over the real en.json catalog.
export function setRequestLocale() {}
export async function getTranslations(options: {
  locale: string
  namespace: string
}) {
  const { scenario } = state.getStore()!
  await run("translator", scenario.translator)
  return createTranslator({ ...options, messages: english } as never)
}

// LaunchDarkly and Admin-backed manifest: inert.
export const isWatchCtaTextCopyEnabled = async () => false
export const isWatchHideBibleQuotesEnabled = async () => false
export const isWatchQuestionPanelEnabled = async () => false
export const getWatchRouteManifest = async () => null

// Marker components: print the translated labels the route hands the client.
export const WatchRouteSurfaceRegistration = () => null
export const WatchHomeFooter = () => null
export const WatchStructuredData = () => null
export function WatchPageClient(props: {
  mergedBlocks: { kind?: string; audioLanguageCountLabel?: string | null }[]
}) {
  const hero = props.mergedBlocks.find((block) => block.kind === "HeroPlayer")
  return <p data-fixture="audio-count">{hero?.audioLanguageCountLabel}</p>
}
