/**
 * PROTOTYPE — key resolution for the chat-eval scripts.
 *
 * These run as plain `tsx` scripts, not through the Mastra CLI, so nothing
 * loads a dotenv file for them. This does it explicitly, and it is the only
 * place a key is read.
 *
 * Resolution order — first one set wins:
 *   1. CHAT_EVAL_OPENROUTER_API_KEY  — dedicated eval key (preferred)
 *   2. OPENROUTER_API_PAID_KEY       — the shared paid key the repo already uses
 *   3. OPENROUTER_API_KEY            — legacy fallback
 *
 * A dedicated key is preferred for cost attribution and independent
 * revocation, NOT because the shared one lacks access. Either works.
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

export const KEY_VARIABLES = [
  "CHAT_EVAL_OPENROUTER_API_KEY",
  "OPENROUTER_API_PAID_KEY",
  "OPENROUTER_API_KEY",
] as const

export function resolveOpenRouterKey(): { key: string; source: string } | null {
  loadEnvFiles()
  for (const name of KEY_VARIABLES) {
    const value = process.env[name]
    if (value != null && value.trim().length > 0) {
      return { key: value.trim(), source: name }
    }
  }
  return null
}

export function keyHelpText(): string {
  return [
    "No OpenRouter key found. Set any one of:",
    ...KEY_VARIABLES.map((name) => `  ${name}`),
    "",
    "Either export it, or put it in apps/mastra/.env.local (gitignored):",
    "  CHAT_EVAL_OPENROUTER_API_KEY=sk-or-v1-...",
    "",
    "Or pull the shared one from Doppler:",
    "  export OPENROUTER_API_PAID_KEY=$(doppler secrets get OPENROUTER_API_PAID_KEY \\",
    "    --project forge-admin --config dev --plain)",
  ].join("\n")
}
