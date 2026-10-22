"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, AbortSignal, module, require */
// The test build pipeline (KTD2, R8): one runner-owned git worktree outside
// the repo, reset to the tested commit, then one release build per platform.
// A prebuild in apps/mobile would delete the developer's own ios/ and android/.

const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { run } = require("../proc")
const { writeTestAppConfig } = require("./appConfig")
const { buildAndroid } = require("./buildAndroid")
const { buildIos } = require("./buildIos")
const {
  TestBuildError,
  buildEnv,
  defaultAndroidHome,
  resolveJavaHome,
  runStep,
  settingValues,
} = require("./env")

const BUILD_INPUTS = Object.freeze([
  "apps/mobile",
  "packages/admin-graphql",
  "packages/watch-url-policy",
  "pnpm-lock.yaml",
  "package.json",
  "patches",
])

const MINUTE = 60_000
const DEFAULT_TIMEOUTS = Object.freeze({
  git: 2 * MINUTE,
  worktreeAdd: 15 * MINUTE,
  install: 20 * MINUTE,
  prebuild: 15 * MINUTE,
  podInstall: 20 * MINUTE,
  xcodebuild: 60 * MINUTE,
  gradle: 60 * MINUTE,
})

const PLATFORMS = ["ios", "android"]

function runnerHome(env = process.env) {
  return (
    env.FORGE_RELEASE_CHECK_HOME ||
    path.join(os.homedir(), "Library/Caches/forge-release-check")
  )
}

function gitEnv(parentEnv) {
  return { PATH: parentEnv.PATH ?? "/usr/bin:/bin", HOME: parentEnv.HOME ?? "" }
}

async function git(args, { cwd, env, timeoutMs = DEFAULT_TIMEOUTS.git }) {
  const result = await run("git", args, { cwd, env, timeoutMs })
  if (result.code !== 0) {
    const detail = (result.stderr || result.error || "").trim().split("\n")[0]
    throw new TestBuildError(
      "git_failed",
      `git ${args[0]} failed: ${detail || `exit ${result.code}`}`,
    )
  }
  return result.stdout
}

/** Paths from `git status --porcelain=v1 -z`; a rename gives its new path. */
function parsePorcelainZ(output) {
  const fields = output.split("\0")
  const paths = []
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]
    if (entry.length < 4) continue
    paths.push(entry.slice(3))
    if (entry[0] === "R" || entry[0] === "C") index += 1
  }
  return [...new Set(paths)].sort()
}

/** R8: the changed or new files in the build inputs, repo-relative. */
async function dirtyBuildInputs({ repoRoot, env = process.env }) {
  const output = await git(
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...BUILD_INPUTS,
    ],
    { cwd: repoRoot, env: gitEnv(env) },
  )
  return parsePorcelainZ(output)
}

async function resolveCommit({ repoRoot, rev = "HEAD", env = process.env }) {
  const output = await git(["rev-parse", "--verify", `${rev}^{commit}`], {
    cwd: repoRoot,
    env: gitEnv(env),
  })
  return output.trim()
}

/** `<home>/worktrees/<12 hex of sha256(git common dir)>`, one per repo. */
async function worktreePath({ repoRoot, home, env = process.env }) {
  const commonDir = (
    await git(["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      env: gitEnv(env),
    })
  ).trim()
  const absolute = fs.realpathSync(path.resolve(repoRoot, commonDir))
  const key = crypto
    .createHash("sha256")
    .update(absolute)
    .digest("hex")
    .slice(0, 12)
  return path.join(home, "worktrees", key)
}

async function registeredWorktrees({ repoRoot, env }) {
  const output = await git(["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    env,
  })
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((dir) => fs.existsSync(dir))
    .map((dir) => fs.realpathSync(dir))
}

// No hook of the developer's runs in the runner worktree.
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"]

// Creates or resets the runner worktree at `commit`, then removes every
// untracked and ignored file except node_modules, so no env file stays.
async function prepareWorktree({ repoRoot, commit, home, env = process.env }) {
  const genv = gitEnv(env)
  const dir = await worktreePath({ repoRoot, home, env })
  const reusable =
    fs.existsSync(path.join(dir, ".git")) &&
    (await registeredWorktrees({ repoRoot, env: genv })).includes(
      fs.realpathSync(dir),
    )
  if (reusable) {
    await git([...NO_HOOKS, "checkout", "--force", "--detach", commit], {
      cwd: dir,
      env: genv,
      timeoutMs: DEFAULT_TIMEOUTS.worktreeAdd,
    })
  } else {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    await git(["worktree", "prune"], { cwd: repoRoot, env: genv })
    await git([...NO_HOOKS, "worktree", "add", "--detach", dir, commit], {
      cwd: repoRoot,
      env: genv,
      timeoutMs: DEFAULT_TIMEOUTS.worktreeAdd,
    })
  }
  await git(["clean", "-ffdx", "-e", "node_modules"], { cwd: dir, env: genv })
  const head = (
    await git(["rev-parse", "HEAD"], { cwd: dir, env: genv })
  ).trim()
  if (head !== commit) {
    throw new TestBuildError(
      "worktree_commit",
      `the runner worktree is at ${head}, not ${commit}`,
    )
  }
  return {
    dir,
    mobileDir: path.join(dir, "apps/mobile"),
    created: !reusable,
  }
}

function stepFailure(steps, name, error) {
  steps.push({ name, ok: false, error: error.message })
  return name
}

// The two platforms build at the same time; a failure on one stops the other
// through its abort signal.
async function buildTestApps({
  repoRoot,
  commit,
  buildDir,
  settings,
  platforms = PLATFORMS,
  home = runnerHome(),
  parentEnv = process.env,
  signal,
  timeouts: overrides = {},
}) {
  const started = Date.now()
  const timeouts = { ...DEFAULT_TIMEOUTS, ...overrides }
  const logDir = path.join(buildDir, "logs")
  const tmpDir = path.join(buildDir, "tmp")
  fs.mkdirSync(logDir, { recursive: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  const steps = []
  const result = (fields) => ({
    commit,
    buildDir,
    worktree: null,
    settingKeys: Object.keys(settingValues(settings)).sort(),
    steps,
    platforms: {},
    durationMs: Date.now() - started,
    ...fields,
  })

  let worktree
  try {
    const step = Date.now()
    worktree = await prepareWorktree({ repoRoot, commit, home, env: parentEnv })
    steps.push({
      name: "worktree",
      ok: true,
      created: worktree.created,
      durationMs: Date.now() - step,
    })
  } catch (error) {
    return result({
      ok: false,
      failedStep: stepFailure(steps, "worktree", error),
    })
  }

  let javaHome = null
  if (platforms.includes("android")) {
    try {
      javaHome = await resolveJavaHome(parentEnv)
    } catch (error) {
      return result({
        ok: false,
        worktree: worktree.dir,
        failedStep: stepFailure(steps, "java-home", error),
      })
    }
  }
  const env = buildEnv({
    parentEnv,
    settings,
    tmpDir,
    javaHome,
    androidHome: platforms.includes("android")
      ? defaultAndroidHome(parentEnv)
      : null,
  })
  const common = { env, logDir, signal }

  const install = await runStep(
    steps,
    "pnpm-install",
    "pnpm",
    ["install", "--frozen-lockfile", "--filter", "@forge/mobile..."],
    { ...common, cwd: worktree.dir, timeoutMs: timeouts.install },
  )
  if (!install.step.ok) {
    return result({
      ok: false,
      worktree: worktree.dir,
      failedStep: "pnpm-install",
    })
  }

  try {
    const written = writeTestAppConfig(worktree.mobileDir)
    steps.push({ name: "app-config", ok: true, ...written })
  } catch (error) {
    return result({
      ok: false,
      worktree: worktree.dir,
      failedStep: stepFailure(steps, "app-config", error),
    })
  }

  const prebuild = await runStep(
    steps,
    "expo-prebuild",
    path.join(worktree.mobileDir, "node_modules/.bin/expo"),
    [
      "prebuild",
      "--clean",
      "--no-install",
      "--platform",
      platforms.length === 1 ? platforms[0] : "all",
    ],
    { ...common, cwd: worktree.mobileDir, timeoutMs: timeouts.prebuild },
  )
  if (!prebuild.step.ok) {
    return result({
      ok: false,
      worktree: worktree.dir,
      failedStep: "expo-prebuild",
    })
  }

  const stopOthers = new AbortController()
  const buildSignal = signal
    ? AbortSignal.any([signal, stopOthers.signal])
    : stopOthers.signal
  const options = {
    mobileDir: worktree.mobileDir,
    env,
    buildDir,
    signal: buildSignal,
    timeouts,
    derivedDataPath: path.join(
      home,
      "cache",
      path.basename(worktree.dir),
      "ios-derived-data",
    ),
  }
  const builders = { ios: buildIos, android: buildAndroid }
  const outcomes = await Promise.all(
    platforms.map(async (platform) => {
      let outcome
      try {
        outcome = await builders[platform](options)
      } catch (error) {
        outcome = {
          platform,
          ok: false,
          artifact: null,
          steps: [
            { name: `${platform}-error`, ok: false, error: error.message },
          ],
          failedStep: `${platform}-error`,
        }
      }
      if (!outcome.ok) stopOthers.abort()
      return outcome
    }),
  )
  const failure = outcomes.find((outcome) => !outcome.ok)
  return result({
    ok: !failure,
    worktree: worktree.dir,
    failedStep: failure ? `${failure.platform}:${failure.failedStep}` : null,
    platforms: Object.fromEntries(
      outcomes.map((outcome) => [outcome.platform, outcome]),
    ),
  })
}

module.exports = {
  BUILD_INPUTS,
  DEFAULT_TIMEOUTS,
  buildTestApps,
  dirtyBuildInputs,
  parsePorcelainZ,
  prepareWorktree,
  resolveCommit,
  runnerHome,
  worktreePath,
}
