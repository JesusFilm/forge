import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { run, state } from "../control.ts"

export * from "../../../src/lib/watch-route-manifest.ts"

const english = JSON.parse(
  readFileSync(join(__dirname, "../../../messages/en.json"), "utf8"),
)

// next-intl/server: same shape as the real async getMessages; success returns
// the real en.json catalog, which the route's real count translator formats.
// The "translator" control step gates this load, the hero translator's input.
export function setRequestLocale() {}
export async function getMessages(_options: { locale: string }) {
  const { scenario } = state.getStore()!
  await run("translator", scenario.translator)
  return english
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
