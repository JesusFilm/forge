/**
 * Guards every Watch client bundle against the Node `crypto` polyfill.
 *
 * When a module reachable from a `"use client"` file imports `node:crypto`,
 * Turbopack does not fail the build: it substitutes crypto-browserify and its
 * stream/buffer shims. One such edge — three event-name constants imported
 * from the server-side consent cookie module — shipped a ~450 KB (decoded)
 * chunk to every Watch route through the locale layout (feat-779). Nothing
 * breaks and no test notices; the page is only heavier.
 *
 * This walks the static import closure of every client module under `src`
 * (`@/` and relative specifiers; `import type` is erased and skipped) and
 * fails if any reached module imports `crypto` or `node:crypto`. Fix a
 * failure by moving the browser-safe export into a dependency-free module,
 * rather than allowlisting the dependency.
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
// Match a quoted side-effect import first so a later `from` clause cannot
// consume that statement and hide its dependency.
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:["']([^"']+)["']|[\s\S]*?\sfrom\s+["']([^"']+)["'])/g
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/g

function specifiers(source: string): string[] {
  return [
    ...[...source.matchAll(IMPORT_PATTERN)].map(
      (match) => match[1] ?? match[2],
    ),
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

function findCryptoPaths(sources?: Map<string, string>): string[] {
  const read =
    sources ??
    new Map(sourceFiles(SRC).map((file) => [file, readFileSync(file, "utf8")]))
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

  it("detects a client importing the server consent helpers", () => {
    // The original client controls were retired on main. Inject their import
    // edge without restoring them, and walk the real server module it reaches.
    const client = join(SRC, "components/crypto-regression-fixture.tsx")
    expect(
      findCryptoPaths(
        new Map([
          [
            client,
            '"use client";\nimport { parseRecommendationConsentCookie } from "@/lib/recommendation-consent"',
          ],
        ]),
      ),
    ).toEqual([
      "components/crypto-regression-fixture.tsx -> lib/recommendation-consent.ts",
    ])
  })

  it.each([
    ["a value import", 'import { languagesIndexPath } from "@/lib/routes"'],
    ["a re-export", 'export { languagesIndexPath } from "@/lib/routes"'],
  ])("detects a side-effect import before %s", (_label, followingStatement) => {
    const client = join(SRC, "components/crypto-regression-fixture.tsx")
    expect(
      findCryptoPaths(
        new Map([
          [
            client,
            `"use client";\nimport "@/lib/recommendation-consent"\n${followingStatement}`,
          ],
        ]),
      ),
    ).toEqual([
      "components/crypto-regression-fixture.tsx -> lib/recommendation-consent.ts",
    ])
  })

  it("retains multiline value imports and re-exports", () => {
    expect(
      specifiers(`import {
        languagesIndexPath,
      } from "@/lib/routes"
      export {
        resolvePosterUrl,
      } from "@/lib/url"`),
    ).toEqual(["@/lib/routes", "@/lib/url"])
  })

  it("ignores erased type imports and exports before a side-effect import", () => {
    expect(
      specifiers(`import type { First } from "./types"
      export type { Second } from "./other-types"
      import "./live"`),
    ).toEqual(["./live"])
  })
})
