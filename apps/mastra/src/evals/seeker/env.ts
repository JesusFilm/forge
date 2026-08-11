/**
 * Seeker eval — key resolution for the eval CLI scripts.
 *
 * These run as plain `tsx` scripts, not through the Mastra CLI, so nothing
 * loads a dotenv file for them. This does it explicitly, and it is the only
 * place a key is read.
 *
 * `CHAT_EVAL_OPENROUTER_API_KEY` IS THE ONLY ACCEPTED KEY. There is no
 * fallback to `OPENROUTER_API_PAID_KEY` or `OPENROUTER_API_KEY`, on purpose.
 *
 * A fallback chain here means an unprovisioned operator silently bills a full
 * eval run to a production credential and never finds out. Either you have the
 * eval's own key — its own spend, its own revocation, its own rate limit — or
 * the run stops and says so. Convenience is not worth an accidental charge
 * against a credential this tool has no business using.
 *
 * The key lives in Doppler under `forge-rag` / `dev`.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Files checked, in order. Existing process env always wins over a file.
 * Both the repo root AND `apps/mastra/` are searched because the package
 * scripts run tsx from the monorepo root (`pnpm --dir ../.. exec tsx ...`)
 * while the documented key location is `apps/mastra/.env.local`.
 */
const ENV_FILES = [
  ".env.local",
  ".env",
  "apps/mastra/.env.local",
  "apps/mastra/.env",
]

let loaded = false

/**
 * Minimal dotenv reader. Deliberately does NOT overwrite anything already in
 * `process.env` — the opposite of what the Mastra CLI does (see
 * apps/mastra/CLAUDE.md "Env-override gotcha"), so an inline
 * `KEY=value pnpm eval:seeker:answers` prefix behaves the way you expect.
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

/** The one and only key this eval will use. No siblings, no fallbacks. */
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
    "It lives in Doppler under forge-rag / dev. Set it by hand in",
    "apps/mastra/.env.local (gitignored):",
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

/**
 * Byte cap for every buffered HTTP response read in the eval clients (the
 * repo's buffered-response byte-cap law — see apps/mastra/CLAUDE.md and the
 * reference implementation in src/services/jesusfilm-rag-client.ts).
 *
 * Sizing: the largest legitimate payload is a judge response of ~2,000 output
 * tokens or a topK-5 RAG result of 5 x 4,000-codepoint passages. At the
 * 3-bytes-per-UTF-16-code-unit worst case that is well under 100 KiB, so the
 * 2 MiB default carries >20x headroom while still bounding a misbehaving
 * upstream. Env knob is OPTIONAL (never required at boot or run) and capped
 * at 16 MiB, mirroring `JESUSFILM_RAG_MAX_RESPONSE_BYTES`.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_RESPONSE_BYTES_CEILING = 16 * 1024 * 1024

export function resolveMaxResponseBytes(): number {
  loadEnvFiles()
  const raw = process.env.CHAT_EVAL_MAX_RESPONSE_BYTES
  if (raw == null || raw.trim().length === 0) return DEFAULT_MAX_RESPONSE_BYTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_RESPONSE_BYTES
  return Math.min(Math.floor(parsed), MAX_RESPONSE_BYTES_CEILING)
}
