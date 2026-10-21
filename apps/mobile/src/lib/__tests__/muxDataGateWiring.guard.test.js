// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The Mux Data gate (KTD3, R25) holds only while the env key stays wired and
// one function reads it. No type check catches a missing `_inlined` entry, and
// a reader that skips the gate would send beacons for a malformed key.

const MOBILE = path.join(__dirname, "..", "..", "..")
const ROOTS = [path.join(MOBILE, "src"), path.join(MOBILE, "app")]

const ENV = "src/env.ts"
const GATE = "src/lib/muxData/config.ts"
const NAME = "EXPO_PUBLIC_MUX_DATA_ENV_KEY"

// A scan that finds nothing proves nothing. The app carries far more than this.
const SOURCE_FILE_FLOOR = 100

/** Comments do not run. The `[^:]` keeps a URL such as `https://` intact. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function read(relativePath) {
  const full = path.join(MOBILE, relativePath)
  expect(fs.existsSync(full)).toBe(true)
  return stripComments(fs.readFileSync(full, "utf8"))
}

/** Every `.ts`/`.tsx` file under the roots, tests excluded. */
function sourceFiles() {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules")
          continue
        walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }
  for (const root of ROOTS) walk(root)
  return found
}

function relative(full) {
  return path.relative(MOBILE, full).split(path.sep).join("/")
}

/** The group that opens with the last character of `head`, braces matched. */
function bracedGroup(source, head) {
  const start = source.indexOf(head)
  if (start === -1) return null
  const openIndex = start + head.length - 1
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1
    else if (source[i] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return null
}

const INLINED = new RegExp(`:\\s*process\\.env\\.${NAME}\\b`)
const LOOSE_OPTIONAL = new RegExp(
  `^\\s*${NAME}: z\\.string\\(\\)\\.optional\\(\\),\\s*$`,
  "m",
)
const RUNTIME = new RegExp(`\\b${NAME}:\\s*process\\.env\\.${NAME}\\b`)
const GATE_READ = new RegExp(`\\benv\\.${NAME}\\b`)

describe(`src/env.ts registers ${NAME}`, () => {
  it("names the value in _inlined", () => {
    const group = bracedGroup(read(ENV), "const _inlined = {")
    expect(group).not.toBeNull()
    expect(group).toMatch(INLINED)
  })

  // A strict schema would stop startup on a bad key. The gate turns Mux off.
  it("keeps the client schema a loose optional string", () => {
    const group = bracedGroup(read(ENV), "client: {")
    expect(group).not.toBeNull()
    expect(group.match(new RegExp(`\\b${NAME}\\b`, "g"))).toHaveLength(1)
    expect(group).toMatch(LOOSE_OPTIONAL)
  })

  it("names the value in runtimeEnvStrict", () => {
    const group = bracedGroup(read(ENV), "runtimeEnvStrict: {")
    expect(group).not.toBeNull()
    expect(group).toMatch(RUNTIME)
  })

  it("rejects an env file that drops an entry (positive control)", () => {
    const source = read(ENV)
    const withoutInlined = source.replace(
      /^\s*muxDataEnvKey:.*$/m,
      "  muxDataEnvKey: undefined,",
    )
    expect(bracedGroup(withoutInlined, "const _inlined = {")).not.toMatch(
      INLINED,
    )
    expect(`${NAME}: z.string().regex(/^[a-z0-9]+$/).optional(),`).not.toMatch(
      LOOSE_OPTIONAL,
    )
    expect(`${NAME}: undefined,`).not.toMatch(RUNTIME)
  })
})

describe("the Mux Data gate is the only reader (KTD3)", () => {
  it("reads the value through env in the gate", () => {
    expect(read(GATE)).toMatch(GATE_READ)
  })

  it("is the only module outside src/env.ts that names the value", () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(SOURCE_FILE_FLOOR)
    const pattern = new RegExp(`\\b${NAME}\\b`)
    const readers = files
      .filter((file) =>
        pattern.test(stripComments(fs.readFileSync(file, "utf8"))),
      )
      .map(relative)
      .sort()
    expect(readers).toEqual([ENV, GATE].sort())
  })

  it("finds a reader wherever it sits (positive control)", () => {
    const pattern = new RegExp(`\\b${NAME}\\b`)
    expect(pattern.test(`const key = env.${NAME}`)).toBe(true)
    expect(pattern.test(`process.env.${NAME}`)).toBe(true)
    expect(pattern.test(stripComments(`// reads ${NAME}`))).toBe(false)
    expect(pattern.test(`${NAME}_OTHER`)).toBe(false)
  })
})
