import "server-only"
import { readdirSync } from "node:fs"
import { join } from "node:path"

// Filesystem discovery of UI translation catalogs at server module-load.
// Adding a new locale = drop messages/{locale}.json + redeploy. Zero code
// change. Server-only because the readdirSync call is Node-only; clients
// receive the active locale via next-intl's provider, not this list.

const messagesDir = join(process.cwd(), "messages")

export const AVAILABLE_UI_LOCALES: readonly string[] = readdirSync(messagesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort()

export const DEFAULT_LOCALE = "en" as const

export function hasUiLocale(candidate: string): boolean {
  return AVAILABLE_UI_LOCALES.includes(candidate)
}
