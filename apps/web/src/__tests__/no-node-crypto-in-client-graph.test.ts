/**
 * Guards every Watch client bundle against the Node `crypto` polyfill.
 *
 * When a module reachable from a `"use client"` file imports `node:crypto`,
 * Turbopack does not fail the build: it substitutes crypto-browserify and its
 * stream/buffer shims. One such edge — three event-name constants imported
 * from the server-side consent cookie module — shipped a ~450 KB (decoded)
 * chunk to every Watch route through the locale layout (feat-755). Nothing
 * breaks and no test notices; the page is only heavier.
 *
 * This walks the static import closure of every client module under `src`
 * (`@/` and relative specifiers; `import type` is erased and skipped) and
 * fails if any reached module imports `crypto` or `node:crypto`. Fix a
 * failure by moving the browser-safe export into a dependency-free module,
 * as `lib/recommendation-consent-events.ts` does — not by allowlisting.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "__mocks__"
        ? []
        : sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)
      ? [path]
      : []
  })
}

function hasDirective(source: string, directive: string): boolean {
  return new RegExp(
    `^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${directive}["']`,
  ).test(source)
}

const isClientModule = (source: string) => hasDirective(source, "use client")
// A client import of a Server Action module bundles only an action reference.
const isServerActionModule = (source: string) =>
  hasDirective(source, "use server")

// Value imports and re-exports, including side-effect imports. `import type`
// and `export type` are erased by the compiler and never reach the bundle.
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/g

function specifiers(source: string): string[] {
  return [
    ...[...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]),
    ...[...source.matchAll(DYNAMIC_IMPORT_PATTERN)].map((match) => match[1]),
  ]
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(from), specifier)
      : null
  if (!base) return null
  if (/\.tsx?$/.test(base) && existsSync(base)) return base
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension
  }
  return null
}

function findCryptoPaths(): string[] {
  const files = sourceFiles(SRC)
  const read = new Map(files.map((file) => [file, readFileSync(file, "utf8")]))
  const findings: string[] = []
  const visited = new Set<string>()

  function walk(file: string, trail: string[]) {
    if (visited.has(file)) return
    visited.add(file)
    const source = read.get(file) ?? readFileSync(file, "utf8")
    if (trail.length > 0 && isServerActionModule(source)) return
    for (const specifier of specifiers(source)) {
      if (specifier === "crypto" || specifier === "node:crypto") {
        findings.push(
          [...trail, file].map((path) => relative(SRC, path)).join(" -> "),
        )
        continue
      }
      const next = resolveLocal(file, specifier)
      if (next) walk(next, [...trail, file])
    }
  }

  for (const [file, source] of read) {
    if (isClientModule(source)) walk(file, [])
  }
  return findings
}

describe("client module graph", () => {
  it("never reaches node:crypto", () => {
    expect(findCryptoPaths()).toEqual([])
  })

  it("would see the original feat-755 leak", () => {
    // Anti-vacuous companion: the server consent module the leak came through
    // still imports node:crypto, and the walker recognises that import.
    const consent = readFileSync(
      join(SRC, "lib/recommendation-consent.ts"),
      "utf8",
    )
    expect(specifiers(consent)).toContain("node:crypto")
    expect(
      isClientModule(
        readFileSync(
          join(
            SRC,
            "components/recommendations/RecommendationConsentShell.tsx",
          ),
          "utf8",
        ),
      ),
    ).toBe(true)
  })
})
