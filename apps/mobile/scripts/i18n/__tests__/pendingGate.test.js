/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The release gate (KTD8, KD13): a production native build and a production
// over-the-air update need an empty pending list, unless I18N_ALLOW_PENDING=1.
const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const MOBILE_DIR = path.join(__dirname, "..", "..", "..")
const GATE = path.join(MOBILE_DIR, "scripts", "i18n", "check-pending-gate.mjs")
const HOOK = path.join(MOBILE_DIR, "scripts", "eas-build-pre-install.sh")
const tempDirs = []

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pending-gate-"))
  tempDirs.push(dir)
  return dir
}

function policyFile(pendingKeys, raw) {
  const file = path.join(tempDir(), "translation-policy.json")
  fs.writeFileSync(
    file,
    raw ??
      JSON.stringify({
        humanReviewedLocales: ["en"],
        intentionallyLocaleNeutral: [],
        englishOnlyLocales: ["crk", "mey-Latn"],
        pendingKeys,
      }),
  )
  return file
}

// The environment is built from nothing, so a real I18N_ALLOW_PENDING or
// EAS_BUILD_PROFILE on the machine cannot change a result.
function runGate(args, env) {
  return childProcess.spawnSync(process.execPath, [GATE, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  })
}

const ONE_PENDING = { "Common.goBackAriaLabel": "2026-09-01" }

describe("check-pending-gate.mjs", () => {
  it("exits 1 for the production profile with one pending key, and names the key and the override", () => {
    const result = runGate(["--policy", policyFile(ONE_PENDING)], {
      EAS_BUILD_PROFILE: "production",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Common.goBackAriaLabel")
    expect(result.stderr).toContain("I18N_ALLOW_PENDING=1")
  })

  it("exits 0 for the preview profile with one pending key", () => {
    const result = runGate(["--policy", policyFile(ONE_PENDING)], {
      EAS_BUILD_PROFILE: "preview",
    })
    expect(result.status).toBe(0)
  })

  it("exits 0 outside an EAS build", () => {
    expect(runGate(["--policy", policyFile(ONE_PENDING)], {}).status).toBe(0)
  })

  it("exits 0 with the override and prints the warning line", () => {
    const result = runGate(["--policy", policyFile(ONE_PENDING)], {
      EAS_BUILD_PROFILE: "production",
      I18N_ALLOW_PENDING: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(
      /^WARNING: I18N_ALLOW_PENDING=1 .*1 pending key.*Common\.goBackAriaLabel/m,
    )
  })

  it("does not honor an override value other than 1", () => {
    const result = runGate(["--policy", policyFile(ONE_PENDING)], {
      EAS_BUILD_PROFILE: "production",
      I18N_ALLOW_PENDING: "true",
    })
    expect(result.status).toBe(1)
  })

  it("exits 1 on the update:production path whatever the build profile", () => {
    const result = runGate(
      ["--update-production", "--policy", policyFile(ONE_PENDING)],
      { EAS_BUILD_PROFILE: "preview" },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("update:production")
  })

  it("exits 0 for production when the pending list is empty, and prints no warning", () => {
    const result = runGate(["--policy", policyFile({})], {
      EAS_BUILD_PROFILE: "production",
      I18N_ALLOW_PENDING: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain("WARNING")
  })

  it("fails closed for production when the policy file is missing", () => {
    const missing = path.join(tempDir(), "absent.json")
    const result = runGate(["--policy", missing], {
      EAS_BUILD_PROFILE: "production",
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(missing)
  })

  it("fails closed for production when the policy file is malformed", () => {
    const result = runGate(["--policy", policyFile(null, "{ not json")], {
      EAS_BUILD_PROFILE: "production",
    })
    expect(result.status).toBe(1)
    const shapeResult = runGate(
      ["--policy", policyFile(null, JSON.stringify({ pendingKeys: ["x"] }))],
      { EAS_BUILD_PROFILE: "production" },
    )
    expect(shapeResult.status).toBe(1)
  })

  it("honors the override on an unreadable policy file, with the warning line", () => {
    const result = runGate(["--policy", path.join(tempDir(), "absent.json")], {
      EAS_BUILD_PROFILE: "production",
      I18N_ALLOW_PENDING: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^WARNING: I18N_ALLOW_PENDING=1 /m)
  })

  it("reads the committed policy by default", () => {
    const result = runGate([], { EAS_BUILD_PROFILE: "production" })
    const committed = JSON.parse(
      fs.readFileSync(
        path.join(MOBILE_DIR, "i18n", "translation-policy.json"),
        "utf8",
      ),
    )
    expect(result.status).toBe(
      Object.keys(committed.pendingKeys).length === 0 ? 0 : 1,
    )
  })

  // EAS runs the pre-install hook before `pnpm install`.
  it("imports only Node built-ins", () => {
    const source = fs.readFileSync(GATE, "utf8")
    const specifiers = [
      ...source.matchAll(
        /\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']/g,
      ),
    ].map((match) => match[1] ?? match[2])
    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter((s) => !s.startsWith("node:"))).toEqual([])
  })
})

describe("eas-build-pre-install.sh", () => {
  // A copy of the hook, the gate, and a policy in the same relative layout.
  function hookFixture(pendingKeys) {
    const root = tempDir()
    fs.mkdirSync(path.join(root, "scripts", "i18n"), { recursive: true })
    fs.mkdirSync(path.join(root, "i18n"))
    fs.copyFileSync(
      HOOK,
      path.join(root, "scripts", "eas-build-pre-install.sh"),
    )
    fs.copyFileSync(
      GATE,
      path.join(root, "scripts", "i18n", "check-pending-gate.mjs"),
    )
    fs.writeFileSync(
      path.join(root, "i18n", "translation-policy.json"),
      JSON.stringify({ pendingKeys }),
    )
    return root
  }

  function runHook(root, env) {
    return childProcess.spawnSync(
      "bash",
      [path.join(root, "scripts", "eas-build-pre-install.sh")],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, ...env } },
    )
  }

  it("fails a production build with a pending key", () => {
    const root = hookFixture(ONE_PENDING)
    expect(runHook(root, { EAS_BUILD_PROFILE: "production" }).status).toBe(1)
  })

  it("passes a preview build with a pending key", () => {
    const root = hookFixture(ONE_PENDING)
    expect(runHook(root, { EAS_BUILD_PROFILE: "preview" }).status).toBe(0)
  })

  it("keeps the Datadog version stamp, and a production build with no pending key passes", () => {
    const root = hookFixture({})
    const result = runHook(root, {
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_GIT_COMMIT_HASH: "abcdef1234567",
    })
    expect(result.status).toBe(0)
    expect(fs.readFileSync(path.join(root, ".env.local"), "utf8")).toContain(
      "EXPO_PUBLIC_DATADOG_VERSION=abcdef1",
    )
  })
})

describe("update:production", () => {
  it("runs the gate before it publishes", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.join(MOBILE_DIR, "package.json"), "utf8"),
    ).scripts
    expect(scripts["update:production"]).toMatch(
      /^node scripts\/i18n\/check-pending-gate\.mjs --update-production && .*eas update --channel production /,
    )
    expect(scripts["update:preview"]).not.toContain("check-pending-gate")
  })
})
