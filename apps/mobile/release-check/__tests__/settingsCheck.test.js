/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// KTD3, R33: the owner-only `check-settings` mode compares the "copied from
// production" class with production's EAS environment, and prints no value of
// any other key.
const { EXIT } = require("../lib/contract")
const {
  EAS_ARGS,
  checkSettingsCommand,
  compareWithProduction,
  parseEnvList,
} = require("../lib/settingsCheck")

const MOBILE_DIR = "/repo/apps/mobile"
const NOW = () => new Date("2026-10-22T23:30:00Z")
// Built at run time, so no secret-shaped text is in the repo.
const DATADOG_TOKEN = `pub${"0f".repeat(16)}`
const ADMIN_TOKEN = ["fleet", "k3y", "9x7", "secret"].join("-")

// Rendered by eas-cli 16.32.0's own `formatVariable` (the npx cache copy) with
// fake variables, through a pipe, so chalk adds no color codes.
const REAL_EAS_16_OUTPUT = `
Environment: production
Variables for this project:
ID            id-1
Name          EXPO_PUBLIC_SIGN_IN_ENABLED
Value         1
Scope         PROJECT
Visibility    PUBLIC
Environments  PRODUCTION
type          string
Created at    Oct 02 01:00:00
Updated at    Oct 03 01:00:00

———

ID            id-2
Name          EXPO_PUBLIC_DATADOG_CLIENT_TOKEN
Value         ***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)
Scope         PROJECT
Visibility    SENSITIVE
Environments  PRODUCTION, PREVIEW
type          string
Created at    Oct 02 01:00:00
Updated at    Oct 03 01:00:00

———

ID            id-3
Name          SENTRY_AUTH_TOKEN
Value         ***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)
Scope         PROJECT
Visibility    SECRET
Environments  PRODUCTION
type          string
Created at    Oct 02 01:00:00
Updated at    Oct 03 01:00:00

———

ID            id-4
Name          EXPO_PUBLIC_AUTH_BASE_URL
Value         https://auth.example.org/a b
Scope         PROJECT
Visibility    PUBLIC
Environments  PRODUCTION
type          string
Created at    Oct 02 01:00:00
Updated at    Oct 03 01:00:00
`

// Captured from `npx --yes eas-cli@16 env:list ...` with an empty HOME.
const NOT_LOGGED_IN = {
  code: 1,
  stdout:
    "An Expo user account is required to proceed.\nEither log in with eas login or set the EXPO_TOKEN environment variable if you're using EAS CLI on CI (Learn more: https://docs.expo.dev/accounts/programmatic-access/)\n",
  stderr:
    "★ eas-cli@25.3.0 is now available.\nTo upgrade, run:\nnpm install -g eas-cli\nProceeding with outdated version.\n\n    Error: env:list command failed.\n",
}

const MASKED_SENSITIVE =
  "***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)"

function block({ name, value, visibility = "PUBLIC", scope = "PROJECT" }) {
  return [
    `ID            id-${name}`,
    `Name          ${name}`,
    `Value         ${value}`,
    `Scope         ${scope}`,
    `Visibility    ${visibility}`,
    "Environments  PRODUCTION",
    "type          string",
    "Created at    Oct 02 01:00:00",
    "Updated at    Oct 03 01:00:00",
  ].join("\n")
}

function easOutput(variables, scope = "project") {
  const header =
    scope === "account"
      ? "Account-wide variables for this account:"
      : "Variables for this project:"
  if (variables.length === 0) {
    return "\nEnvironment: production\nNo variables found for this environment.\n"
  }
  const blocks = variables.map((variable) =>
    block({ ...variable, scope: scope === "account" ? "SHARED" : "PROJECT" }),
  )
  return `\nEnvironment: production\n${header}\n${blocks.join("\n\n———\n\n")}\n`
}

function settingsWith(copiedFromProduction, mustBeUnset = []) {
  return {
    schemaVersion: 1,
    productionCheckedAt: null,
    ports: {
      device: 38211,
      hostIos: 38211,
      hostAndroidPhone: 38212,
      hostAndroidTablet: 38213,
    },
    copiedFromProduction,
    testValue: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "http://localhost:38211/api/graphql",
      EXPO_PUBLIC_RECOMMENDATIONS_ENABLED: "false",
    },
    mustBeUnset,
    muxDataEnvKeyDigests: [],
  }
}

function fakeRun(byScope) {
  const calls = []
  const run = async (command, args, options) => {
    calls.push({ command, args, options })
    const scope = args.includes("--scope")
      ? args[args.indexOf("--scope") + 1]
      : "project"
    const answer = byScope[scope] ?? { stdout: easOutput([], scope) }
    return {
      code: answer.code ?? 0,
      signal: null,
      timedOut: answer.timedOut ?? false,
      stopped: false,
      stdout: answer.stdout ?? "",
      stderr: answer.stderr ?? "",
      durationMs: 1,
      error: null,
    }
  }
  return { run, calls }
}

async function runCheck(settings, byScope, extra = {}) {
  const outLines = []
  const errLines = []
  const fake = fakeRun(byScope)
  const code = await checkSettingsCommand(
    { mode: "check-settings", flags: {}, positionals: [] },
    {
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      run: fake.run,
      settings,
      mobileDir: MOBILE_DIR,
      env: { PATH: "/usr/bin:/bin", HOME: "/Users/owner" },
      now: NOW,
      ...extra,
    },
  )
  return {
    code,
    out: outLines.join("\n"),
    err: errLines.join("\n"),
    all: [...outLines, ...errLines].join("\n"),
    calls: fake.calls,
  }
}

function pasteObject(out) {
  const lines = out.split("\n")
  const start = lines.findIndex((line) => line.startsWith("Paste this object"))
  const end = lines.findIndex((line, index) => index > start && line === "}")
  return JSON.parse(lines.slice(start + 1, end + 1).join("\n"))
}

describe("parseEnvList", () => {
  it("reads the real eas-cli 16 long format, with masked values as unknown", () => {
    expect(parseEnvList(REAL_EAS_16_OUTPUT)).toEqual([
      {
        name: "EXPO_PUBLIC_SIGN_IN_ENABLED",
        value: "1",
        masked: false,
        visibility: "PUBLIC",
        scope: "PROJECT",
      },
      {
        name: "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
        value: null,
        masked: true,
        visibility: "SENSITIVE",
        scope: "PROJECT",
      },
      {
        name: "SENTRY_AUTH_TOKEN",
        value: null,
        masked: true,
        visibility: "SECRET",
        scope: "PROJECT",
      },
      {
        name: "EXPO_PUBLIC_AUTH_BASE_URL",
        value: "https://auth.example.org/a b",
        masked: false,
        visibility: "PUBLIC",
        scope: "PROJECT",
      },
    ])
  })

  it("reads an environment with no variables as an empty list", () => {
    expect(parseEnvList(easOutput([]))).toEqual([])
  })
})

describe("compareWithProduction", () => {
  it("names the key whose production value differs from the list", () => {
    const production = new Map([
      ["EXPO_PUBLIC_SIGN_IN_ENABLED", { value: "1", masked: false }],
    ])
    const result = compareWithProduction(
      settingsWith({ EXPO_PUBLIC_SIGN_IN_ENABLED: null }),
      production,
    )
    expect(result.findings).toEqual([
      {
        code: "PRODUCTION_VALUE_DIFFERS",
        message:
          'EXPO_PUBLIC_SIGN_IN_ENABLED is "1" in production and unset in the list.',
        setting: "EXPO_PUBLIC_SIGN_IN_ENABLED",
        file: "apps/mobile/release-check/config/test-settings.json",
        deviceId: null,
      },
    ])
    expect(result.paste).toEqual({ EXPO_PUBLIC_SIGN_IN_ENABLED: "1" })
  })
})

describe("check-settings", () => {
  it("gives exit 1 and names the key when production's value differs", async () => {
    const result = await runCheck(
      settingsWith({
        EXPO_PUBLIC_EXPLORE_ENABLED: "1",
        EXPO_PUBLIC_SIGN_IN_ENABLED: null,
      }),
      {
        project: {
          stdout: easOutput([
            { name: "EXPO_PUBLIC_EXPLORE_ENABLED", value: "1" },
            { name: "EXPO_PUBLIC_SIGN_IN_ENABLED", value: "true" },
          ]),
        },
      },
    )
    expect(result.code).toBe(EXIT.failed)
    expect(result.out).toContain(
      'PRODUCTION_VALUE_DIFFERS: EXPO_PUBLIC_SIGN_IN_ENABLED is "true" in production and unset in the list.',
    )
    expect(result.out).not.toContain("EXPO_PUBLIC_EXPLORE_ENABLED is")
    expect(pasteObject(result.out)).toEqual({
      EXPO_PUBLIC_EXPLORE_ENABLED: "1",
      EXPO_PUBLIC_SIGN_IN_ENABLED: "true",
    })
  })

  it("gives exit 0 when every copied value matches, with the paste object and today's UTC date", async () => {
    const result = await runCheck(
      settingsWith({
        EXPO_PUBLIC_AUTH_BASE_URL: null,
        EXPO_PUBLIC_EXPLORE_ENABLED: "1",
      }),
      {
        project: {
          stdout: easOutput([
            { name: "EXPO_PUBLIC_EXPLORE_ENABLED", value: "1" },
          ]),
        },
      },
    )
    expect(result.code).toBe(EXIT.passed)
    expect(result.out).toContain("check-settings passed")
    expect(pasteObject(result.out)).toEqual({
      EXPO_PUBLIC_AUTH_BASE_URL: null,
      EXPO_PUBLIC_EXPLORE_ENABLED: "1",
    })
    expect(result.out).toContain(
      'set "productionCheckedAt" to "2026-10-22" (today, UTC)',
    )
  })

  it("reports a production EXPO_PUBLIC key that the list does not classify, without its value", async () => {
    const result = await runCheck(settingsWith({}), {
      project: {
        stdout: easOutput([
          { name: "EXPO_PUBLIC_NEW_KEY", value: "new-key-value-77" },
          { name: "SENTRY_ORG", value: "sentry-org-value-88" },
        ]),
      },
    })
    expect(result.code).toBe(EXIT.failed)
    expect(result.out).toContain(
      "PRODUCTION_KEY_UNCLASSIFIED: Production sets EXPO_PUBLIC_NEW_KEY",
    )
    expect(result.all).not.toContain("SENTRY_ORG")
    expect(result.all).not.toContain("new-key-value-77")
    expect(result.all).not.toContain("sentry-org-value-88")
  })

  it("names a mustBeUnset key that production sets, and prints its value nowhere", async () => {
    const result = await runCheck(
      settingsWith({ EXPO_PUBLIC_SIGN_IN_ENABLED: null }, [
        "EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN",
        "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
        "EXPO_PUBLIC_UI_PSEUDO_LOCALE",
      ]),
      {
        project: {
          stdout: easOutput([
            { name: "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN", value: DATADOG_TOKEN },
            { name: "EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN", value: ADMIN_TOKEN },
            {
              name: "EXPO_PUBLIC_ADMIN_GRAPHQL_URL",
              value: "https://admin.example.org/api/graphql",
            },
          ]),
        },
      },
    )
    expect(result.code).toBe(EXIT.passed)
    expect(result.out).toContain(
      "- EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: production sets it",
    )
    expect(result.out).toContain(
      "- EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: production sets it",
    )
    expect(result.out).toContain(
      "- EXPO_PUBLIC_UI_PSEUDO_LOCALE: production does not set it",
    )
    expect(result.all).not.toContain(DATADOG_TOKEN)
    expect(result.all).not.toContain(ADMIN_TOKEN)
    expect(result.all).not.toContain("admin.example.org")
  })

  it("refuses with exit 2 and the login command when no Expo account is logged in", async () => {
    const result = await runCheck(
      settingsWith({ EXPO_PUBLIC_SIGN_IN_ENABLED: null }),
      { project: NOT_LOGGED_IN, account: NOT_LOGGED_IN },
    )
    expect(result.code).toBe(EXIT.refused)
    expect(result.err).toContain("no Expo account is logged in")
    expect(result.err).toContain("`npx eas-cli login`")
    expect(result.out).toBe("")
  })

  it("reports a masked value as set with an unknown value", async () => {
    const result = await runCheck(
      settingsWith({ EXPO_PUBLIC_AUTH_BASE_URL: "https://auth.example.org" }, [
        "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
      ]),
      {
        project: {
          stdout: easOutput([
            {
              name: "EXPO_PUBLIC_AUTH_BASE_URL",
              value: MASKED_SENSITIVE,
              visibility: "SENSITIVE",
            },
            {
              name: "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
              value: MASKED_SENSITIVE,
              visibility: "SENSITIVE",
            },
          ]),
        },
      },
    )
    expect(result.code).toBe(EXIT.failed)
    expect(result.out).toContain(
      "- EXPO_PUBLIC_AUTH_BASE_URL: production sets it, value unknown (masked)",
    )
    expect(result.out).toContain(
      "PRODUCTION_VALUE_UNKNOWN: Production sets EXPO_PUBLIC_AUTH_BASE_URL",
    )
    expect(result.out).toContain(
      "- EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: production sets it",
    )
    expect(pasteObject(result.out)).toEqual({
      EXPO_PUBLIC_AUTH_BASE_URL: "https://auth.example.org",
    })
    expect(result.all).not.toContain("*****")
  })

  it("lets a project variable override an account-wide one, and reads account-only keys", async () => {
    const result = await runCheck(
      settingsWith({ EXPO_PUBLIC_EXPLORE_ENABLED: "1" }),
      {
        project: {
          stdout: easOutput([
            { name: "EXPO_PUBLIC_EXPLORE_ENABLED", value: "1" },
          ]),
        },
        account: {
          stdout: easOutput(
            [
              { name: "EXPO_PUBLIC_EXPLORE_ENABLED", value: "0" },
              { name: "EXPO_PUBLIC_ACCOUNT_KEY", value: "account-value-55" },
            ],
            "account",
          ),
        },
      },
    )
    expect(result.code).toBe(EXIT.failed)
    expect(result.out).not.toContain("PRODUCTION_VALUE_DIFFERS")
    expect(result.out).toContain(
      "PRODUCTION_KEY_UNCLASSIFIED: Production sets EXPO_PUBLIC_ACCOUNT_KEY",
    )
    expect(result.all).not.toContain("account-value-55")
  })

  it("refuses an output that it cannot read instead of reporting a match", async () => {
    const result = await runCheck(
      settingsWith({ EXPO_PUBLIC_SIGN_IN_ENABLED: null }),
      {
        project: {
          stdout: `Environment: production\n${block({ name: "EXPO_PUBLIC_SIGN_IN_ENABLED", value: "1" })}\n`,
        },
      },
    )
    expect(result.code).toBe(EXIT.refused)
    expect(result.err).toContain("cannot read the output of")
    expect(result.out).toBe("")
  })

  it("refuses with exit 2 when eas-cli fails or passes its deadline", async () => {
    const failed = await runCheck(settingsWith({}), {
      project: {
        code: 1,
        stdout:
          "You don't have the required permissions to perform this operation.\n",
        stderr: "    Error: env:list command failed.\n",
      },
    })
    expect(failed.code).toBe(EXIT.refused)
    expect(failed.err).toContain(
      "You don't have the required permissions to perform this operation.",
    )
    const late = await runCheck(settingsWith({}), {
      project: { code: null, timedOut: true },
    })
    expect(late.code).toBe(EXIT.refused)
    expect(late.err).toContain("did not finish in 180 s")
  })

  it("shows no output tail when a failed run had already printed variables", async () => {
    // Cut off after the value, so the value is inside the tail's last lines.
    const cutOff = easOutput([
      { name: "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN", value: DATADOG_TOKEN },
    ]).split("\nScope")[0]
    const result = await runCheck(settingsWith({}), {
      project: {
        code: 1,
        stdout: cutOff,
        stderr: "    Error: env:list command failed.\n",
      },
    })
    expect(result.code).toBe(EXIT.refused)
    expect(result.err).toContain("failed with exit code 1")
    expect(result.all).not.toContain(DATADOG_TOKEN)
  })

  it("refuses a list that puts one key in two classes, before it reads production", async () => {
    const result = await runCheck(
      settingsWith({ EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: null }, [
        "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
      ]),
      {},
    )
    expect(result.code).toBe(EXIT.refused)
    expect(result.err).toContain(
      "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN is in copiedFromProduction and mustBeUnset",
    )
    expect(result.calls).toEqual([])
  })

  it("runs eas-cli from apps/mobile with only PATH, HOME, and EXPO_TOKEN", async () => {
    const result = await runCheck(
      settingsWith({}),
      {},
      {
        env: {
          PATH: "/opt/bin:/usr/bin",
          HOME: "/Users/owner",
          EXPO_TOKEN: "expo-token-value",
          EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: DATADOG_TOKEN,
          NODE_OPTIONS: "--inspect",
        },
      },
    )
    expect(result.code).toBe(EXIT.passed)
    expect(result.calls.map((call) => [call.command, call.args])).toEqual([
      [
        "npx",
        [
          "--yes",
          "eas-cli@16",
          "env:list",
          "--environment",
          "production",
          "--format",
          "long",
          "--non-interactive",
        ],
      ],
      [
        "npx",
        [
          "--yes",
          "eas-cli@16",
          "env:list",
          "--environment",
          "production",
          "--format",
          "long",
          "--non-interactive",
          "--scope",
          "account",
        ],
      ],
    ])
    expect(EAS_ARGS).toEqual(result.calls[0].args)
    for (const call of result.calls) {
      expect(call.options.cwd).toBe(MOBILE_DIR)
      expect(call.options.env).toEqual({
        PATH: "/opt/bin:/usr/bin",
        HOME: "/Users/owner",
        EXPO_TOKEN: "expo-token-value",
      })
      expect(call.options.timeoutMs).toBe(180000)
    }
  })
})
