import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { applyStressOverrides } from "./speakify-tts"
import { repoRoot } from "./repo-root"
import { accentRussianHybrid, type AccentDeps } from "./russian-accent"

/**
 * Disk-cached wrapper over the multi-model stress consensus, plus the speakify
 * builder used by the audio path.
 *
 * The consensus costs several LLM calls, so each unique line is accented ONCE
 * and cached (keyed by text hash) under devo/cache — later renders and other
 * devotionals reuse it. Owner-pinned overrides (homographs) are applied FIRST,
 * then consensus fills the rest and keeps the pins (its prompt preserves marks).
 * Paragraph breaks ("\n\n", the render's real-silence pause points) are kept.
 */

const CACHE_PATH = path.join(repoRoot(), "devo/cache", "ru-accent-cache.json")
let mem: Record<string, string> | null = null

async function load(): Promise<Record<string, string>> {
  if (mem) return mem
  try {
    mem = JSON.parse(await readFile(CACHE_PATH, "utf8")) as Record<string, string>
  } catch {
    mem = {}
  }
  return mem
}

async function save(): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true })
  await writeFile(CACHE_PATH, JSON.stringify(mem ?? {}, null, 2) + "\n", "utf8")
}

/** Accent one line via consensus, memoized on disk by text hash. */
export async function accentCached(
  text: string,
  deps: AccentDeps = {},
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return text
  const key = createHash("sha256").update(trimmed).digest("hex")
  const cache = await load()
  if (cache[key] != null) return cache[key]
  const accented = await accentRussianHybrid(trimmed, deps)
  cache[key] = accented
  await save()
  return accented
}

/**
 * Build the RU `speakify`: pin owner overrides, then auto-accent the rest by
 * consensus, per paragraph (so "\n\n" pause markers survive). Spoken-only.
 */
export function buildAccentingSpeakify(
  overrides: ReadonlyArray<readonly [string, string]>,
  deps: AccentDeps = {},
): (text: string) => Promise<string> {
  return async (text: string) => {
    const parts = text.split(/\n{2,}/)
    const accented = await Promise.all(
      parts.map((p) => accentCached(applyStressOverrides(p, overrides), deps)),
    )
    return accented.join("\n\n")
  }
}
