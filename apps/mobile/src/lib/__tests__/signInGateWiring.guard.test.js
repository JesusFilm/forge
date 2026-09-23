// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The sign-in gate (feat-543) holds only while every sign-in entry point reads
// it. jest-expo opens the gate in every suite, so no render test sees an entry
// point that forgot the gate. This guard reads the sources instead.

const MOBILE = path.join(__dirname, "..", "..", "..")
const ROOTS = [path.join(MOBILE, "src"), path.join(MOBILE, "app")]

const AUTH_ACTIONS = "src/lib/authActions.ts"
const BINDER = "src/lib/signInGate.ts"
const ENV = "src/env.ts"

// The signed-in re-authentication step inside account deletion. R9 keeps it
// open whatever the gate holds, so it is the one ungated caller.
const UNGATED_CALLERS = ["src/components/profile/DeleteAccountFlow.tsx"]

const GATED_SURFACES = [
  "src/components/profile/AccountSection.tsx",
  "src/components/watch/SignInPrompt.tsx",
]

const HOSTED_SIGN_IN = /\bsignInWithHostedPage\b/
const HOSTED_SIGN_IN_CALL = /\bsignInWithHostedPage\s*\(/
const GATE_CALL = /\bisSignInAvailable\s*\(/
const CLIENT_SIGN_IN_CALL = /\.signIn\s*\.\s*\w+\s*\(/

/** Comments do not run. The `[^:]` keeps a URL such as `https://` intact. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [full]
  })
}

function relative(full) {
  return path.relative(MOBILE, full).split(path.sep).join("/")
}

const SOURCES = ROOTS.flatMap(sourceFiles).map((full) => ({
  file: relative(full),
  source: stripComments(fs.readFileSync(full, "utf8")),
}))

const SOURCE_BY_FILE = new Map(
  SOURCES.map(({ file, source }) => [file, source]),
)

function read(relativePath) {
  const source = SOURCE_BY_FILE.get(relativePath)
  expect(source).toBeDefined()
  return source
}

/** Every file that names the hosted sign-in, other than its own module. */
function hostedSignInCallers() {
  return SOURCES.filter(
    ({ file, source }) => file !== AUTH_ACTIONS && HOSTED_SIGN_IN.test(source),
  )
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

describe("the sign-in gate wiring (feat-543)", () => {
  it("scans enough files that an empty walk cannot pass", () => {
    expect(SOURCES.length).toBeGreaterThan(100)
  })

  it("finds the Profile card and the nudge as gated callers (positive control)", () => {
    const gated = hostedSignInCallers()
      .filter(({ source }) => GATE_CALL.test(source))
      .map(({ file }) => file)
    expect(gated).toEqual(expect.arrayContaining(GATED_SURFACES))
  })

  // Rule 1: a reference counts as well as a call, so `onPress={signIn...}`
  // cannot skip the gate.
  it("gates every caller of signInWithHostedPage except the deletion step", () => {
    const ungated = hostedSignInCallers()
      .filter(({ file }) => !UNGATED_CALLERS.includes(file))
      .filter(({ source }) => !GATE_CALL.test(source))
      .map(({ file }) => file)
    expect(ungated).toEqual([])
  })

  // Rule 2: a stale allowlist entry fails, and a gate added to the deletion
  // step fails too, because R9 keeps that step open.
  it.each(UNGATED_CALLERS)(
    "%s still signs in again and never reads the gate",
    (file) => {
      const source = read(file)
      expect(source).toMatch(HOSTED_SIGN_IN_CALL)
      expect(source).not.toMatch(GATE_CALL)
    },
  )

  // Rule 3: the binder passes the real inputs, never a literal.
  it("binds the resolver to __DEV__ and the env value", () => {
    const source = read(BINDER)
    expect(source).toMatch(
      /export function isSignInAvailable\(\): boolean \{\s*return resolveSignInAvailable\(\s*__DEV__,\s*env\.EXPO_PUBLIC_SIGN_IN_ENABLED,?\s*\)\s*\}/,
    )
    expect(source).not.toMatch(/\b(true|false)\b/)
  })

  // Rule 4: no type check catches a missing `_inlined` entry, and Metro inlines
  // the value only from module scope. A strict schema stops startup on a typo.
  describe("src/env.ts registers the variable in all three places", () => {
    it("names the value in _inlined", () => {
      const group = bracedGroup(read(ENV), "const _inlined = {")
      expect(group).not.toBeNull()
      expect(group).toMatch(/:\s*process\.env\.EXPO_PUBLIC_SIGN_IN_ENABLED\b/)
    })

    it("keeps the client schema a loose optional string", () => {
      const group = bracedGroup(read(ENV), "client: {")
      expect(group).not.toBeNull()
      expect(group.match(/\bEXPO_PUBLIC_SIGN_IN_ENABLED\b/g)).toHaveLength(1)
      expect(group).toMatch(
        /^\s*EXPO_PUBLIC_SIGN_IN_ENABLED: z\.string\(\)\.optional\(\),\s*$/m,
      )
    })

    it("names the value in runtimeEnvStrict", () => {
      const group = bracedGroup(read(ENV), "runtimeEnvStrict: {")
      expect(group).not.toBeNull()
      expect(group).toMatch(
        /\bEXPO_PUBLIC_SIGN_IN_ENABLED:\s*process\.env\.EXPO_PUBLIC_SIGN_IN_ENABLED\b/,
      )
    })
  })

  // Rule 5: a direct call of the auth client's sign-in would skip both the
  // gate and signInWithHostedPage, so only the auth actions module may make it.
  it("calls the auth client's sign-in methods only from the auth actions", () => {
    const direct = SOURCES.filter(({ source }) =>
      CLIENT_SIGN_IN_CALL.test(source),
    ).map(({ file }) => file)
    expect(direct).toEqual([AUTH_ACTIONS])
  })
})
