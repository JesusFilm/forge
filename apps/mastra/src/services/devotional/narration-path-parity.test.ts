import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Structural guard: narration must be produced in exactly ONE place.
 *
 * The pipeline had two entry points that drifted apart without anyone noticing.
 * The CLI scripts passed `produceDevotionalAudio` a full set of deps — per-
 * segment reuse, real-silence pauses between sentences, card pacing — and then
 * checked completeness before persisting. The registered Mastra workflow (the
 * path an agent or a second person would use) called `produceDevotionalAudio`
 * bare: no reuse, so one edited sentence re-voiced all ~21 segments and drained
 * the ElevenLabs quota; no pauses or pacing, so the audio was measurably worse;
 * and no completeness check, so it wrote partial narration into the very cache
 * the CLI path reads back.
 *
 * None of that was visible in any test, because each path worked on its own
 * terms. These tests fail if a new caller starts producing narration directly
 * again, which is the only way this particular divergence can return.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, "../..")

/** The ONE module allowed to call produceDevotionalAudio with deps + guard. */
const SHARED_PRODUCER = "services/devotional/devotional-render.ts"

/**
 * Deliberate exception: an audio-only preview script that exists precisely to
 * try alternative voices and pacing, so it needs its own dep set. It is held to
 * the same completeness guard, which is what actually matters — asserted below.
 */
const ALLOWED_DIRECT_CALLERS = new Set([
  SHARED_PRODUCER,
  "scripts/devo-audio-track.ts",
  // Where produceDevotionalAudio is DEFINED — a declaration is not a call site.
  "services/devotional/devotional-audio.ts",
])

/** Where saveCachedAudio is DEFINED; it cannot guard itself. */
const CACHE_MODULE = "services/devotional/devotional-cache.ts"

/**
 * Strip comments and string literals before matching. Without this the guard
 * reads its own explanatory prose as a call site — the comment in the workflow
 * that says what it USED to call would be indistinguishable from still calling
 * it, which would make this test permanently red for the right change.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
      out.push(full)
  }
  return out
}

describe("narration is produced through one shared path", () => {
  it("no new caller invokes produceDevotionalAudio directly", async () => {
    const files = await walk(SRC)
    const callers: string[] = []
    for (const f of files) {
      const src = code(await readFile(f, "utf8"))
      // A CALL, not the import or the type-only reference.
      if (/produceDevotionalAudio\s*\(/.test(src)) {
        callers.push(path.relative(SRC, f))
      }
    }
    const unexpected = callers.filter((c) => !ALLOWED_DIRECT_CALLERS.has(c)).sort()
    expect(
      unexpected,
      `These call produceDevotionalAudio directly and so bypass per-segment ` +
        `reuse, sentence pauses, card pacing and the completeness guard. Call ` +
        `produceNarration() from devotional-render.ts instead — that is what it ` +
        `is for. If a caller genuinely needs its own deps, add it to ` +
        `ALLOWED_DIRECT_CALLERS *and* make it call assertNarrationComplete.`,
    ).toEqual([])
  })

  it("every writer of the audio cache checks completeness first", async () => {
    // The cache is the seam between steps and between the two entry points, so a
    // partial write by any one caller becomes a broken video for all of them.
    const files = await walk(SRC)
    const offenders: string[] = []
    for (const f of files) {
      const src = code(await readFile(f, "utf8"))
      if (!/saveCachedAudio\s*\(/.test(src)) continue
      const rel = path.relative(SRC, f)
      if (rel === CACHE_MODULE) continue
      const guarded =
        /assertNarrationComplete\s*\(/.test(src) || /produceNarration\s*\(/.test(src)
      if (!guarded) offenders.push(rel)
    }
    expect(
      offenders.sort(),
      `These persist narration to the shared audio cache without first calling ` +
        `assertNarrationComplete (directly or via produceNarration). An ` +
        `incomplete cache reads back as usable and ships a video missing a card.`,
    ).toEqual([])
  })

  it("the Mastra workflow routes narration through the shared producer", async () => {
    // Named explicitly because this is the path an agent or a second person
    // uses, and it is the one that had none of the hardening.
    const wf = code(
      await readFile(
        path.join(SRC, "mastra/workflows/video-first-devotional.ts"),
        "utf8",
      ),
    )
    expect(wf).toMatch(/produceNarration\s*\(/)
    expect(wf).toMatch(/assertNarrationComplete\s*\(/)
    expect(wf).not.toMatch(/produceDevotionalAudio\s*\(/)
  })
})
