/**
 * Seeker eval — shared CLI plumbing for the seven entrypoint scripts
 * (decision 2026-08-04 #9, consolidating the review's finding-#9 count:
 * `flag` ×7, `csv` ×2, `loadFixtures` ×5 under two divergent contracts —
 * the async swallow-to-null variant WAS findings #4/#12).
 *
 * `loadFixtures` has ONE contract: fail closed, loudly, with DISTINCT
 * messages for an absent file, an unreadable file, corrupt JSON, and a
 * wrong-kind file — each has a different fix, and every entrypoint's
 * main() maps a throw to a nonzero exit. The "proceed without fixtures"
 * lane for mode-"none" runs lives at the PURE APIs (evaluateGate's
 * nullable fixtures input; run-judge/run-report passing null explicitly
 * when `runRequiresFixtures` says no) — never inside this loader.
 *
 * Deliberately dependency-light: imports only node builtins, ./rag, and
 * ./types (none of which reach the agent module), so run-loop's
 * spend-guard static-import pin stays intact.
 */
import { readFile } from "node:fs/promises"

import { loadableFixtureFile, type RagFixtureFile } from "./rag"
import type { RunIdentity } from "./types"

/** `--name=value` argv lookup shared by every entrypoint. */
export function flag(
  argv: readonly string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/** Comma-separated flag value → trimmed entries, empties dropped. */
export function csv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Fail-closed fixtures load (review findings #4/#12). A swallowed load
 * failure silently vacates the grounded-citation lane (gate) or grades
 * every answer against an empty world (judge), so absence, unreadability,
 * corruption, and wrong kind each throw their own loud message.
 */
export async function loadFixtures(path: string): Promise<RagFixtureFile> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      throw new Error(
        `fixtures file not found at ${path} — run eval:seeker:capture-rag against a live RAG, or pass --fixtures=<path>`,
      )
    }
    throw new Error(
      `fixtures file at ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `fixtures file at ${path} is not valid JSON — restore or re-capture it`,
    )
  }
  const file = loadableFixtureFile(parsed)
  if (!file) {
    throw new Error(`${path} is not a chat-eval RAG fixture file (wrong kind)`)
  }
  return file
}

/**
 * Fixture requirement keyed on a run's retrieval mode (review finding #12):
 * a "fixtures" or "tool-loop" run was GENERATED against served passages, so
 * grading or reporting it without them falsifies every grounding signal.
 * Only a mode-"none" (or unstamped legacy) run proceeds without fixtures —
 * reached explicitly by the caller, never via a swallowed load error.
 */
export function runRequiresFixtures(
  retrieval: RunIdentity["retrieval"] | undefined,
): boolean {
  return retrieval?.mode === "fixtures" || retrieval?.mode === "tool-loop"
}
