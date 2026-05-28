import "server-only"
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Filesystem discovery of UI translation catalogs at server module-load.
// Adding a new locale = drop messages/{locale}.json + redeploy. Zero code
// change. Server-only because the readdirSync call is Node-only; clients
// receive the active locale via next-intl's provider, not this list.

const moduleDir = dirname(fileURLToPath(import.meta.url))
// Anchor to the source tree, not process.cwd(). cwd varies across
// invocation modes (monorepo root, apps/web dev, containerized build)
// and would otherwise produce a runtime ENOENT at boot.
const messagesDir = join(moduleDir, "../../messages")

export const DEFAULT_LOCALE = "en" as const

function discoverLocales(): readonly string[] {
  try {
    return readdirSync(messagesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort()
  } catch (err) {
    // Last-resort fallback: a misconfigured deploy degrades to English
    // chrome instead of 500-ing the entire boot. The log surfaces the
    // misconfiguration without blocking traffic.
    console.error(
      "[i18n] failed to read messages dir; falling back to default locale only",
      err,
    )
    return [DEFAULT_LOCALE]
  }
}

export const AVAILABLE_UI_LOCALES = discoverLocales()

// Brand type so callers that gate on `hasUiLocale()` can pass the
// narrowed value into next-intl's `setRequestLocale` without an
// `as` cast. The brand is opaque — the only way to obtain a UiLocale
// is via the type predicate below, which guarantees the value was
// matched against the runtime catalog list.
declare const uiLocaleBrand: unique symbol
export type UiLocale = string & { readonly [uiLocaleBrand]: true }

export function hasUiLocale(candidate: string): candidate is UiLocale {
  return AVAILABLE_UI_LOCALES.includes(candidate)
}
