import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * A person has to read the text before anyone pays to voice it.
 *
 * `--review` alone made that optional: a run without the flag went straight
 * from generation to ElevenLabs, and the first time anyone saw the wording was
 * in a finished video. This turns it around — narration refuses to start until
 * the text has been approved, so forgetting the flag costs nothing instead of
 * costing a narration.
 *
 * The approval is bound to the TEXT, not to the cache directory, so editing
 * devo.json or regenerating invalidates it automatically. There is no way to
 * approve one wording and quietly ship another.
 */

const FILE = "text-approved.json"

/** What a viewer would actually hear, hashed. */
export function textFingerprint(spoken: string[]): string {
  return createHash("sha256")
    .update(spoken.join("\n"))
    .digest("hex")
    .slice(0, 16)
}

type Approval = { fingerprint: string; approvedAt: string }

export async function readApproval(cacheDir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(cacheDir, FILE), "utf8")
    const parsed = JSON.parse(raw) as Partial<Approval>
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null
  } catch {
    return null
  }
}

export async function writeApproval(
  cacheDir: string,
  fingerprint: string,
  now: string,
): Promise<void> {
  const body: Approval = { fingerprint, approvedAt: now }
  await writeFile(
    path.join(cacheDir, FILE),
    `${JSON.stringify(body, null, 2)}\n`,
    "utf8",
  )
}

export type ApprovalState = "approved" | "never-reviewed" | "text-changed"

export async function approvalState(
  cacheDir: string,
  spoken: string[],
): Promise<ApprovalState> {
  const stored = await readApproval(cacheDir)
  if (stored === null) return "never-reviewed"
  return stored === textFingerprint(spoken) ? "approved" : "text-changed"
}

/** What to tell an operator whose run just stopped, and why. */
export function approvalMessage(
  state: Exclude<ApprovalState, "approved">,
): string {
  return state === "never-reviewed"
    ? "This text has not been read by anyone yet. Nothing has been sent to TTS."
    : "The text CHANGED since it was approved, so the old approval no longer " +
        "covers it. Nothing has been sent to TTS."
}
