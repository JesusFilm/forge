// Plain JS (like the adapter guard): the RN tsconfig has no Node types, and
// this guard needs fs/path to walk the module graph.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (U6): every module app/_layout.tsx reaches is parsed before the first
// paint. The walk starts at the LAYOUT, not the host — a heavy import through
// either door is the same regression, and both leave the rest of CI green.
const FORBIDDEN_LOCAL = [
  "src/components/watch/VideoPlayer.tsx",
  "src/components/watch/PlayerControls.tsx",
  "src/components/watch/SubtitleOverlay.tsx",
  "src/components/watch/PlayerLoadingVeil.tsx",
  "src/components/watch/Scrubber.tsx",
  "src/components/ui/PlatformBlur.tsx",
  "src/components/ui/CircularSpinner.tsx",
]

// Measured, not assumed. `@expo/vector-icons` sat here while the walk started
// at the host; the layout imports Ionicons directly for its header back
// buttons, so at cold-launch scope asserting it would be theatre.
const FORBIDDEN_PACKAGES = ["expo-blur", "expo-image", "expo-linear-gradient"]

// Modules the host genuinely needs. Asserting they ARE present is what stops a
// broken walker from passing the two forbidden checks with an empty graph.
const REQUIRED_LOCAL = [
  "src/components/watch/PlaybackHost.tsx",
  "src/hooks/useManagedVideoPlayer.ts",
  "src/lib/playerBufferOptions.ts",
  "src/lib/miniPlayer/store.ts",
]

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"]

/**
 * Value specifiers, from BOTH forms. `import type` erases at compile time,
 * which is why playerBufferOptions.ts can name expo-video's VideoPlayer for
 * free — but app/_layout.tsx resolves every dependency through `require()`
 * inside one try/catch, so an import-only parser is blind to the whole layout.
 */
function valueSpecifiers(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
  const found = []
  const importPattern =
    /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g
  let match
  while ((match = importPattern.exec(withoutComments)) != null) {
    if (match[3] != null) {
      found.push(match[3])
    } else if (!/^\s*type\s/.test(match[1] ?? "")) {
      found.push(match[2])
    }
  }
  const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  while ((match = requirePattern.exec(withoutComments)) != null) {
    found.push(match[1])
  }
  return found
}

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const extension of ["", ...EXTENSIONS]) {
    const candidate = base + extension
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(base, `index${extension}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** Package name from a specifier: `expo-video/build/x` → `expo-video`. */
function packageName(specifier) {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

function walkGraph(root, entryRelative) {
  const locals = new Set()
  const packages = new Set()

  function visit(file) {
    if (locals.has(file)) return
    locals.add(file)
    const source = fs.readFileSync(file, "utf8")
    for (const specifier of valueSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        packages.add(packageName(specifier))
        continue
      }
      const resolved = resolveLocal(file, specifier)
      if (resolved != null) visit(resolved)
    }
  }

  visit(path.resolve(root, entryRelative))
  return {
    locals: [...locals].map((file) => path.relative(root, file)).sort(),
    packages: [...packages].sort(),
  }
}

// src/components/watch/__tests__ → the app root, four levels up.
const ROOT = path.resolve(__dirname, "../../../..")
const ENTRY = "app/_layout.tsx"

describe("cold-launch module graph", () => {
  it("reaches the modules the host actually needs", () => {
    const { locals } = walkGraph(ROOT, ENTRY)

    for (const required of REQUIRED_LOCAL) expect(locals).toContain(required)
  })

  it("never reaches the player UI", () => {
    const { locals } = walkGraph(ROOT, ENTRY)

    expect(locals.filter((file) => FORBIDDEN_LOCAL.includes(file))).toEqual([])
  })

  it("never reaches a rendering-only native package", () => {
    const { packages } = walkGraph(ROOT, ENTRY)

    expect(
      packages.filter((name) => FORBIDDEN_PACKAGES.includes(name)),
    ).toEqual([])
  })

  it("positive control: the walker follows a relative value import", () => {
    // VideoPlayer.tsx is the module the fix moved away from, so walking IT must
    // reach everything the layout must not — otherwise the three checks above
    // could pass on a walker that follows nothing.
    const { locals, packages } = walkGraph(
      ROOT,
      "src/components/watch/VideoPlayer.tsx",
    )

    for (const forbidden of FORBIDDEN_LOCAL) expect(locals).toContain(forbidden)
    for (const name of FORBIDDEN_PACKAGES) expect(packages).toContain(name)
  })

  it("positive control: the walker follows a require() through real source", () => {
    // The discriminating case. The layout names PlaybackHost only in a type
    // position and a require(), so an import-only parser reaches NOTHING below
    // it — including every module the first check above demands.
    const entrySource = fs.readFileSync(path.resolve(ROOT, ENTRY), "utf8")
    const importOnly = entrySource.replace(/\brequire\s*\(/g, "notRequire(")
    const { locals } = walkGraph(ROOT, ENTRY)

    expect(valueSpecifiers(importOnly)).not.toContain(
      "../src/components/watch/PlaybackHost",
    )
    expect(valueSpecifiers(entrySource)).toContain(
      "../src/components/watch/PlaybackHost",
    )
    expect(locals).toContain("src/components/watch/PlaybackHost.tsx")
  })

  it("positive control: type-only imports are skipped, value imports are not", () => {
    expect(
      valueSpecifiers(
        [
          'import type { VideoPlayer } from "expo-video"',
          'import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"',
          'export type { SheetCounter } from "./suppression"',
          'import "./sideEffect"',
          'let Stack: typeof import("expo-router").Stack',
          '  Ionicons = require("@expo/vector-icons/Ionicons").default',
          '  const color = require("../src/lib/color")',
        ].join("\n"),
      ),
    ).toEqual([
      "../../hooks/useManagedVideoPlayer",
      "./sideEffect",
      "@expo/vector-icons/Ionicons",
      "../src/lib/color",
    ])
  })
})
