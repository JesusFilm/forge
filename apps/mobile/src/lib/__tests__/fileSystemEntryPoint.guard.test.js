// Plain JS (like the other guards here): the RN tsconfig has no Node types, and
// this guard reads installed package files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: raw export must take `Directory` / `File` from the `expo-file-system`
// ROOT and `documentDirectory` from its `/legacy` subpath, and never the other
// way round.
//
// The package root re-exports `legacyWarnings`, whose functions are stubs whose
// whole body is `throw errorOnLegacyMethodUse(...)` — the package's own doc
// comment says "This method will throw in runtime." Those ten sit on the root's
// TYPED surface, so taking one from the root passes tsc, eslint and every mocked
// test, then fails on a real device. The `Directory` / `File` classes ARE the
// root's own API and work.
//
// `documentDirectory` is the asymmetric case: the root exports it neither at
// runtime nor in `build/index.d.ts`, so moving that half to the root fails the
// build today. That is a premise about the installed package, not a guarantee,
// which is why the layer below pins it rather than trusting it.
//
// `expo-media-library` shipped the silent form of this break in this file's
// neighbour once, and the wiring guard missed it because a name grep reads the
// call, never the module the specifier resolves to. This file replaces the guard
// that pinned it, for the package that took its place.
//
// Three independent layers below: the runtime capability (does the module this
// app imports really supply the calls), the upstream premise (does the root
// still withhold `documentDirectory` and still stub the legacy functions), and
// the wiring (does the source name the right entry point for each half).

const APP_ROOT = path.resolve(__dirname, "../../..")
const RUNTIME = "src/lib/rawExportRuntime.ts"
const ROOT_SPECIFIER = "expo-file-system"
const LEGACY_SPECIFIER = "expo-file-system/legacy"

/** The folder picker, which the runtime calls on the class itself. */
const DIRECTORY_STATICS = ["pickDirectoryAsync"]
/** Called on a `Directory`, and on the entries `list()` hands back. */
const DIRECTORY_MEMBERS = ["list", "delete"]
/** Called on the staged `File` to name it, duplicate it and clear a retry. */
const FILE_MEMBERS = ["copy", "rename", "delete"]
/** Called on a bundled Bible `File` to read it (feat-551 U3). */
const BIBLE_FILE_MEMBERS = ["text"]
const BIBLE_LOADER = "src/lib/bible/data/bundled.ts"

/** The two classes the root supplies and the runtime imports from it. */
const ROOT_CLASSES = ["Directory", "File"]

// Every legacy binding this app still imports from `/legacy`. The root replaces
// all of them with a throwing stub, except `documentDirectory`, which the root
// does not export at all.
const STUBBED_ON_ROOT = [
  "copyAsync",
  "deleteAsync",
  "downloadAsync",
  "getFreeDiskStorageAsync",
  "getInfoAsync",
  "getTotalDiskCapacityAsync",
  "makeDirectoryAsync",
  "moveAsync",
  "readAsStringAsync",
  "readDirectoryAsync",
]
const LEGACY_ONLY_BINDING = "documentDirectory"

/** Strip comments so a mention in prose cannot satisfy an assertion. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/* ---------------------------------------------------------------- layer 1 */

/**
 * Everything the composition root needs from a module and does not get. Pure,
 * so a control can run it over a stand-in and prove it reports a real gap.
 */
function capabilityGaps(module) {
  const gaps = []
  const { Directory, File } = module

  for (const name of ROOT_CLASSES) {
    if (typeof module[name] !== "function") gaps.push(name)
  }
  for (const name of DIRECTORY_STATICS) {
    if (typeof Directory?.[name] !== "function") gaps.push(`Directory.${name}`)
  }
  if (gaps.length > 0) return gaps

  const folder = new Directory("file:///guard/folder/")
  for (const name of DIRECTORY_MEMBERS) {
    if (typeof folder[name] !== "function") gaps.push(`Directory#${name}`)
  }

  const staged = new File("file:///guard/folder/clip.mp4")
  for (const name of [...FILE_MEMBERS, ...BIBLE_FILE_MEMBERS]) {
    if (typeof staged[name] !== "function") gaps.push(`File#${name}`)
  }
  if (typeof staged.name !== "string") gaps.push("File#name")
  return gaps
}

/* ---------------------------------------------------------------- layer 2 */

/** The installed package directory, resolved rather than assumed. */
function packageDirectory() {
  return path.dirname(
    require.resolve(`${ROOT_SPECIFIER}/package.json`, { paths: [APP_ROOT] }),
  )
}

/** The file an entry point in the package's `exports` map really points at. */
function entryFile(subpath) {
  const directory = packageDirectory()
  const entry = require(path.join(directory, "package.json")).exports[subpath]
  const target = typeof entry === "string" ? entry : entry.default
  return path.join(directory, target)
}

/** Resolve a relative specifier inside the package to a file that exists. */
function resolveSibling(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    `${base}.ts`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

/** Value names a module source exports. Types are excluded on purpose. */
function collectNames(source, names) {
  const declared =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declared)) names.add(match[1])

  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of block[1].split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim()
      if (name && !name.startsWith("type ")) names.add(name)
    }
  }
  return names
}

/** What an entry point exports, following its `export * from "./x"` one level. */
function exportedNames(file) {
  const source = fs.readFileSync(file, "utf8")
  const names = collectNames(source, new Set())

  for (const star of source.matchAll(
    /export\s+\*\s+from\s+['"](\.[^'"]+)['"]/g,
  )) {
    const sibling = resolveSibling(file, star[1])
    if (sibling) collectNames(fs.readFileSync(sibling, "utf8"), names)
  }
  return names
}

/** The module the root star-exports its deprecated surface from. */
function legacyWarningsFile() {
  const root = entryFile(".")
  const source = fs.readFileSync(root, "utf8")
  const star = source.match(
    /export\s+\*\s+from\s+['"](\.[^'"]*[Ll]egacyWarnings)['"]/,
  )
  return star ? resolveSibling(root, star[1]) : null
}

/** Names whose body is NOT just `throw errorOnLegacyMethodUse(...)`. */
function nonThrowingStubs(source, names) {
  return names.filter((name) => {
    const declaration = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${name}\\b`,
    )
    const start = source.search(declaration)
    if (start === -1) return true

    const rest = source.slice(start)
    const end = rest.indexOf("\nexport ")
    const body = end === -1 ? rest : rest.slice(0, end)
    return !/\bthrow errorOnLegacyMethodUse\(/.test(body)
  })
}

/* ---------------------------------------------------------------- layer 3 */

/** The named bindings one import statement pulls from `specifier`. */
function importedNames(source, specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`,
    "g",
  )
  const names = new Set()

  for (const match of stripComments(source).matchAll(pattern)) {
    for (const entry of match[1].split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim()
      if (name) names.add(name)
    }
  }
  return names
}

describe("raw export imports each file-system binding from the entry point that works", () => {
  it("the root this app imports really supplies every call it makes", () => {
    // The strongest layer: resolve the module and look at what is there, rather
    // than trusting the specifier string.
    expect(capabilityGaps(require(ROOT_SPECIFIER))).toEqual([])
  })

  it("the root supplies no `documentDirectory` at runtime", () => {
    expect(LEGACY_ONLY_BINDING in require(ROOT_SPECIFIER)).toBe(false)
  })

  it("positive control: the capability reader names the member that is missing", () => {
    class Folder {
      list() {}
      delete() {}
    }
    Folder.pickDirectoryAsync = async () => {}
    class Staged {
      constructor() {
        this.name = "clip.mp4"
      }
      copy() {}
      delete() {}
      text() {}
    }

    expect(capabilityGaps({ Directory: Folder, File: Staged })).toEqual([
      "File#rename",
    ])
    expect(capabilityGaps({})).toEqual([
      ...ROOT_CLASSES,
      "Directory.pickDirectoryAsync",
    ])
  })

  it("upstream premise: the root still withholds the legacy bindings", () => {
    // Read the installed package, not a copy. A future SDK that puts these back
    // on the root turns this red, and the split import can be revisited — which
    // is the point of pinning a premise this app cannot otherwise see.
    const rootNames = exportedNames(entryFile("."))

    for (const name of ROOT_CLASSES) expect(rootNames.has(name)).toBe(true)
    expect(rootNames.has(LEGACY_ONLY_BINDING)).toBe(false)
    expect(STUBBED_ON_ROOT.filter((name) => !rootNames.has(name))).toEqual([])
  })

  it("upstream premise: the legacy subpath still supplies `documentDirectory`", () => {
    // jest-expo replaces `expo-file-system/legacy` with a ten-function mock that
    // has no `documentDirectory`, so this half cannot be proven at runtime here.
    // Reading the installed entry point is the only layer left that can see it.
    const legacyNames = exportedNames(entryFile("./legacy"))

    expect(legacyNames.has(LEGACY_ONLY_BINDING)).toBe(true)
    for (const name of ROOT_CLASSES) expect(legacyNames.has(name)).toBe(false)
  })

  it("upstream premise: the root's legacy exports are throwing stubs", () => {
    const file = legacyWarningsFile()
    expect(file).not.toBeNull()

    const source = fs.readFileSync(file, "utf8")
    expect(nonThrowingStubs(source, STUBBED_ON_ROOT)).toEqual([])
    // The classes must keep coming from the root's own modules. A bump that
    // moves either into this file makes the root import the broken one.
    const stubNames = collectNames(source, new Set())
    for (const name of ROOT_CLASSES) expect(stubNames.has(name)).toBe(false)
  })

  it("positive control: the premise readers see a drifted package", () => {
    const drifted = collectNames(
      'export const documentDirectory = "file:///docs/"\nexport { File } from "./File"\n',
      new Set(),
    )

    expect(drifted.has(LEGACY_ONLY_BINDING)).toBe(true)
    expect(drifted.has("File")).toBe(true)
    expect(
      nonThrowingStubs(
        "export async function getInfoAsync() {\n  return real()\n}\n",
        ["getInfoAsync"],
      ),
    ).toEqual(["getInfoAsync"])
    expect(nonThrowingStubs("", ["getInfoAsync"])).toEqual(["getInfoAsync"])
  })

  it("the composition root takes the classes from the package root", () => {
    const source = fs.readFileSync(path.join(APP_ROOT, RUNTIME), "utf8")
    const fromRoot = importedNames(source, ROOT_SPECIFIER)

    for (const name of ROOT_CLASSES) expect(fromRoot.has(name)).toBe(true)
    expect(fromRoot.has(LEGACY_ONLY_BINDING)).toBe(false)
  })

  it("the composition root takes `documentDirectory` from the legacy subpath", () => {
    const source = fs.readFileSync(path.join(APP_ROOT, RUNTIME), "utf8")
    const fromLegacy = importedNames(source, LEGACY_SPECIFIER)

    expect(fromLegacy.has(LEGACY_ONLY_BINDING)).toBe(true)
    for (const name of ROOT_CLASSES) expect(fromLegacy.has(name)).toBe(false)
  })

  it("the Bible loader takes `File` from the package root, never legacy", () => {
    const source = fs.readFileSync(path.join(APP_ROOT, BIBLE_LOADER), "utf8")

    expect(importedNames(source, ROOT_SPECIFIER).has("File")).toBe(true)
    expect(importedNames(source, LEGACY_SPECIFIER).size).toBe(0)
  })

  it("positive control: the wiring reader catches each swap", () => {
    // Both reverts are one edit, and each one is the whole defect.
    const rootOnly =
      'import { Directory, documentDirectory, File } from "expo-file-system"\n'
    expect(
      importedNames(rootOnly, ROOT_SPECIFIER).has(LEGACY_ONLY_BINDING),
    ).toBe(true)
    expect(importedNames(rootOnly, LEGACY_SPECIFIER).size).toBe(0)

    const legacyOnly =
      'import { Directory, documentDirectory, File } from "expo-file-system/legacy"\n'
    expect(importedNames(legacyOnly, LEGACY_SPECIFIER).has("Directory")).toBe(
      true,
    )
    expect(importedNames(legacyOnly, ROOT_SPECIFIER).size).toBe(0)
  })
})
