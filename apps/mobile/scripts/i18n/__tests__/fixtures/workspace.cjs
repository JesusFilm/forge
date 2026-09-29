"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
// A temporary mobile + web layout for the translate command tests. The command
// reads every path from --mobile-dir, --web-dir, --inventory, and --progress-dir.

const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { pathToFileURL } = require("url")
const ops = require("../../lib/catalogOps")

const MOBILE_DIR = path.resolve(__dirname, "../../../..")
const REPO_DIR = path.resolve(MOBILE_DIR, "../..")
const COMMAND = path.join(MOBILE_DIR, "scripts/i18n/translate-catalogs.mjs")
const REAL_WEB_DIR = path.join(REPO_DIR, "apps/web")
const REAL_INVENTORY = path.join(
  REPO_DIR,
  "docs/i18n/watch-ui-official-language-inventory.json",
)
const DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17"
// Never a real credential: every test run points the web script at a fake.
const TEST_API_KEY = "test-only-not-a-key"

const roots = []

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, ops.renderJson(value))
}

function namespacesOf(tree) {
  return Object.fromEntries(
    Object.keys(tree).map((namespace) => [
      namespace,
      `The ${namespace} area of the test app.`,
    ]),
  )
}

function makeWorkspace({
  en,
  catalogs = {},
  record,
  policy = {},
  contexts,
  modelTable,
  webTags,
  webDir,
  webScript = "fake-translate-ui-catalogs.mjs",
  inventory,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-i18n-"))
  roots.push(root)
  const mobileDir = path.join(root, "mobile")
  const messagesDir = path.join(mobileDir, "messages")
  const i18nDir = path.join(mobileDir, "i18n")
  const files = {
    policy: path.join(i18nDir, "translation-policy.json"),
    contexts: path.join(i18nDir, "translation-contexts.json"),
    manifest: path.join(i18nDir, "script-manifest.json"),
    provenance: path.join(i18nDir, "translation-provenance.json"),
    modelTable: path.join(i18nDir, "model-table.json"),
    record: path.join(i18nDir, "source-record.json"),
  }
  const sourceFlat = ops.flattenCatalog(en)
  writeJson(path.join(messagesDir, "en.json"), en)
  for (const [locale, tree] of Object.entries(catalogs)) {
    writeJson(path.join(messagesDir, `${locale}.json`), tree)
  }
  writeJson(files.policy, {
    humanReviewedLocales: ["en"],
    intentionallyLocaleNeutral: [],
    englishOnlyLocales: ["crk", "mey-Latn"],
    pendingKeys: {},
    ...policy,
  })
  writeJson(
    files.contexts,
    contexts ?? { product: "a test app", namespaces: namespacesOf(en) },
  )
  fs.copyFileSync(
    path.join(MOBILE_DIR, "i18n/script-manifest.json"),
    files.manifest,
  )
  writeJson(files.provenance, {
    reviewStatus: "machine-translated; native-speaker review recommended",
    machineTranslatedLocales: {},
  })
  writeJson(
    files.modelTable,
    modelTable ?? { defaultModel: DEFAULT_MODEL, locales: {} },
  )
  writeJson(files.record, {
    englishHashes:
      record ??
      Object.fromEntries(
        Object.entries(sourceFlat).map(([key, text]) => [
          key,
          ops.englishHash(text),
        ]),
      ),
  })

  let resolvedWebDir = webDir
  if (!resolvedWebDir) {
    resolvedWebDir = path.join(root, "web")
    const scriptsDir = path.join(resolvedWebDir, "scripts")
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.copyFileSync(
      path.join(__dirname, webScript),
      path.join(scriptsDir, "translate-ui-catalogs.mjs"),
    )
    // The command and the fake both take web's real contract rule.
    fs.writeFileSync(
      path.join(scriptsDir, "openai-catalog-translator.mjs"),
      `export * from ${JSON.stringify(pathToFileURL(path.join(REAL_WEB_DIR, "scripts/openai-catalog-translator.mjs")).href)}\n`,
    )
    for (const tag of webTags ?? ["en", ...Object.keys(catalogs)]) {
      writeJson(path.join(resolvedWebDir, "messages", `${tag}.json`), {})
    }
  }
  const inventoryPath = inventory ?? path.join(root, "inventory.json")
  if (!inventory) {
    writeJson(inventoryPath, {
      languages: (webTags ?? Object.keys(catalogs)).map((tag) => ({
        tag,
        countries: [],
      })),
    })
  }
  const progressDir = path.join(root, "progress")
  fs.mkdirSync(progressDir)

  const workspace = {
    root,
    mobileDir,
    messagesDir,
    webDir: resolvedWebDir,
    inventory: inventoryPath,
    progressDir,
    files,
    log: path.join(root, "fake-web.log"),
    args: [
      "--mobile-dir",
      mobileDir,
      "--web-dir",
      resolvedWebDir,
      "--inventory",
      inventoryPath,
      "--progress-dir",
      progressDir,
    ],
    readJson: (name) => JSON.parse(fs.readFileSync(files[name], "utf8")),
    readCatalog: (locale) =>
      ops.flattenCatalog(
        JSON.parse(
          fs.readFileSync(path.join(messagesDir, `${locale}.json`), "utf8"),
        ),
      ),
    hasCatalog: (locale) =>
      fs.existsSync(path.join(messagesDir, `${locale}.json`)),
    readLog: () =>
      fs.existsSync(workspace.log)
        ? fs
            .readFileSync(workspace.log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
    /** Every file under mobile/, as text, to prove a run changed nothing. */
    snapshot: () => {
      const out = {}
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else
            out[path.relative(mobileDir, full)] = fs.readFileSync(full, "utf8")
        }
      }
      walk(mobileDir)
      return out
    },
  }
  return workspace
}

function commandEnv(workspace, env = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FAKE_WEB_LOG: workspace.log,
    OPENAI_API_KEY: TEST_API_KEY,
    ...env,
  }
}

/** Runs the command with a piped stdin, so it never sees a terminal. */
function runCommand(workspace, args, env) {
  return childProcess.spawnSync(
    process.execPath,
    [COMMAND, ...workspace.args, ...args],
    { encoding: "utf8", env: commandEnv(workspace, env), input: "" },
  )
}

function runCommandAsync(workspace, args, env) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      process.execPath,
      [COMMAND, ...workspace.args, ...args],
      { env: commandEnv(workspace, env), stdio: ["ignore", "pipe", "pipe"] },
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, stdout, stderr }))
  })
}

function removeWorkspaces() {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
}

module.exports = {
  COMMAND,
  DEFAULT_MODEL,
  MOBILE_DIR,
  REAL_INVENTORY,
  REAL_WEB_DIR,
  REPO_DIR,
  TEST_API_KEY,
  makeWorkspace,
  removeWorkspaces,
  runCommand,
  runCommandAsync,
}
