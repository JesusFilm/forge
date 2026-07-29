/**
 * PROTOTYPE — key resolution for the chat-eval scripts.
 *
 * These run as plain `tsx` scripts, not through the Mastra CLI, so nothing
 * loads a dotenv file for them. This does it explicitly, and it is the only
 * place a key is read.
 *
 * `CHAT_EVAL_OPENROUTER_API_KEY` IS THE ONLY ACCEPTED KEY. There is no
 * fallback to `OPENROUTER_API_PAID_KEY` or `OPENROUTER_API_KEY`, on purpose.
 *
 * A fallback chain here means an unprovisioned operator silently bills a full
 * eval run to admin's production credential and never finds out. Either you
 * have the eval's own key — its own spend, its own revocation, its own rate
 * limit — or the run stops and says so. Convenience is not worth an
 * accidental charge against a credential this tool has no business using.
 *
 * The key lives in Doppler under `forge-rag` / `dev`; fetch it with
 * `pnpm --filter @forge/mastra proto:fetch-key`.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

/** Files checked, in order. Existing process env always wins over a file. */
const ENV_FILES = [".env.local", ".env"]

let loaded = false

/**
 * Minimal dotenv reader. Deliberately does NOT overwrite anything already in
 * `process.env` — the opposite of what the Mastra CLI does (see
 * apps/mastra/CLAUDE.md "Env-override gotcha"), so an inline
 * `KEY=value pnpm proto:answers` prefix behaves the way you expect.
 */
export function loadEnvFiles(cwd = process.cwd()): void {
  if (loaded) return
  loaded = true
  for (const file of ENV_FILES) {
    const path = resolve(cwd, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue
      const separator = trimmed.indexOf("=")
      if (separator < 1) continue
      const key = trimmed.slice(0, separator).trim()
      if (process.env[key] != null) continue
      const raw = trimmed.slice(separator + 1).trim()
      process.env[key] = raw.replace(/^["'](.*)["']$/, "$1")
    }
  }
}

/** The one and only key this prototype will use. No siblings, no fallbacks. */
export const KEY_VARIABLE = "CHAT_EVAL_OPENROUTER_API_KEY" as const

/** Keys that must NEVER be picked up here — see the header. */
const REFUSED_KEYS = ["OPENROUTER_API_PAID_KEY", "OPENROUTER_API_KEY"] as const

export function resolveOpenRouterKey(): { key: string; source: string } | null {
  loadEnvFiles()
  const value = process.env[KEY_VARIABLE]
  if (value == null || value.trim().length === 0) return null
  return { key: value.trim(), source: KEY_VARIABLE }
}

/**
 * Call before doing any work. A missing key is a setup fault, not a result:
 * without this the runner grinds through every cell, records a wall of
 * identical failures, and writes an output file that looks like a run.
 */
export function requireOpenRouterKey(): void {
  if (resolveOpenRouterKey() == null) {
    throw new Error(keyHelpText())
  }
}

export function keyHelpText(): string {
  const alsoPresent = REFUSED_KEYS.filter(
    (name) => (process.env[name] ?? "").trim().length > 0,
  )
  return [
    `${KEY_VARIABLE} is not set. This is the only key the eval accepts.`,
    "",
    "Fetch it from Doppler (forge-rag / dev):",
    "  pnpm --filter @forge/mastra proto:fetch-key",
    "",
    "Or set it by hand in apps/mastra/.env.local (gitignored):",
    `  ${KEY_VARIABLE}=sk-or-v1-...`,
    ...(alsoPresent.length > 0
      ? [
          "",
          `Refusing to use ${alsoPresent.join(" / ")}, which ${
            alsoPresent.length > 1 ? "are" : "is"
          } set here.`,
          `That credential belongs to another surface; the eval must never`,
          "bill a run to it.",
        ]
      : []),
  ].join("\n")
}
