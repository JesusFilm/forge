import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * `@forge/video-player/mux-video` pulls `@mux/mux-video-react`, which carries
 * hls.js and mux-embed — together a ~646 KB chunk that Turbopack groups into
 * one the Watch routes' client entry loads as a plain `<script src>`.
 *
 * Deferring ONE call site does not move it: with the home carousel's import
 * removed entirely and three sibling section renderers still static, the chunk
 * stayed in `firstLoadChunkPaths` for both Watch routes at full size. It only
 * splits out once EVERY importer is behind `next/dynamic`. That makes this a
 * whole-tree invariant, not a per-file one — a single new static importer
 * anywhere puts the whole engine back on the critical path, and no behavioural
 * test would notice.
 *
 * Three ways back onto the critical path, so three things are scanned:
 *   1. a static import of the player module itself;
 *   2. a VALUE import of the `@forge/video-player` barrel, which re-exports
 *      the same module (`packages/video-player/src/index.ts`) and whose package
 *      declares no `sideEffects`, so a bundler cannot drop it. Every such
 *      import in `apps/web` is `import type` today and nothing enforces that —
 *      there is no `verbatimModuleSyntax` and no `consistent-type-imports` rule;
 *   3. a direct import of the upstream `@mux/*` packages, bypassing the
 *      workspace wrapper entirely.
 *
 * See FGE-138 / feat-535, and
 * `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
 */
const SPECIFIER = "@forge/video-player/mux-video"

/** Modules allowed to name the player specifier at all. */
const OWNERS = [
  "src/components/video/deferred-mux-video.tsx",
  "src/components/watch/HeroPlayer.tsx",
]

/**
 * `{ ssr: false }` is load-bearing and separately revertible: dropping it
 * leaves the `dynamic()` call matching a laxer regex while Next's loadable
 * flips to its server branch and server-renders the player again. The test
 * stub for `next/dynamic` ignores options entirely, so no behavioural test
 * covers it either.
 */
const DEFERRED_IMPORT =
  /dynamic\(\s*\(\)\s*=>\s*import\(\s*"@forge\/video-player\/mux-video"\s*\)\s*,\s*\{[^}]*\bssr\s*:\s*false\b/

/**
 * Broad on purpose: a prettier-wrapped import spans newlines, and
 * `export ... from` re-exports just as hard as an import. The bounded
 * negative lookahead stops a match running past the end of its own statement
 * into the next one's specifier.
 */
const BARREL_VALUE_IMPORT =
  /^\s*import\s+(?!type\b)(?:(?!\bimport\b)[\s\S]){0,400}?["']@forge\/video-player["']/m

const UPSTREAM_MUX_IMPORT =
  /^\s*(?:import|export)\b(?:(?!\b(?:import|export)\b)[\s\S]){0,400}?["']@mux\/mux-(?:video|player)-react["']/m

/** Drops line and block comments so prose cannot satisfy an import matcher. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await sourceFiles(path)))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    // Test files and the shared `next/dynamic` stub legitimately name these
    // specifiers without being production import sites.
    if (/\.test\.tsx?$/.test(entry.name)) continue
    if (path.includes("__mocks__")) continue
    found.push(path)
  }
  return found
}

describe("mux-video deferral", () => {
  it("keeps every production importer behind a deferred, client-only import", async () => {
    const files = await sourceFiles("src")
    const namers: string[] = []
    const undeferred: string[] = []
    const barrelValueImporters: string[] = []
    const upstreamImporters: string[] = []

    for (const path of files) {
      // Comment-stripped, so a doc comment naming the module is not mistaken
      // for an import — the false positive that would tempt someone to loosen
      // `OWNERS` rather than fix a real regression. A dynamic `import()` is a
      // call expression, not a statement, so membership is a substring test
      // and the STATEMENT regexes below carry the violation checks.
      const source = stripComments(await readFile(path, "utf8"))
      if (source.includes(SPECIFIER)) {
        namers.push(path)
        if (!DEFERRED_IMPORT.test(source)) undeferred.push(path)
      }
      if (BARREL_VALUE_IMPORT.test(source)) barrelValueImporters.push(path)
      if (UPSTREAM_MUX_IMPORT.test(source)) upstreamImporters.push(path)
    }

    // Anti-vacuous: if the scan stops finding the owners, every assertion
    // below would pass for the wrong reason.
    expect(namers.sort()).toEqual([...OWNERS].sort())
    // Each owner defers it, with `ssr: false` still on the call.
    expect(undeferred).toEqual([])
    // The barrel re-exports the same module, so a value import of it is the
    // same regression wearing a different specifier.
    expect(barrelValueImporters).toEqual([])
    // And so is reaching past the workspace wrapper to the upstream package.
    expect(upstreamImporters).toEqual([])
  })
})
