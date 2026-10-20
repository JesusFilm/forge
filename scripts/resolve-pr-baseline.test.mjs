import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { resolvePrBaseline } from "./resolve-pr-baseline.mjs"

const checker = fileURLToPath(
  new URL("./check-new-roadmap-ids.mjs", import.meta.url),
)
const resolver = fileURLToPath(
  new URL("./resolve-pr-baseline.mjs", import.meta.url),
)

function repository(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "forge-pr-baseline-"))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  git("init", "--initial-branch=main")
  git("config", "user.name", "Baseline test")
  git("config", "user.email", "baseline@example.invalid")
  function commit(message, files = {}) {
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
      writeFileSync(path.join(cwd, file), contents)
    }
    git("add", ".")
    git("commit", "--allow-empty", "-m", message)
    return git("rev-parse", "HEAD")
  }
  const openingBase = commit("chore: initialize")
  function mergePr() {
    const headSha = git("rev-parse", "pr")
    git("checkout", "main")
    git("merge", "--no-ff", "pr", "-m", "Merge PR")
    return { cwd, headSha, mergeSha: git("rev-parse", "HEAD") }
  }
  return { cwd, git, commit, openingBase, mergePr }
}

function ticket(id) {
  return `---\nid: "${id}"\n---\n`
}

function checkRoadmap(cwd, target) {
  const result = spawnSync(process.execPath, [checker], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ROADMAP_ID_BASE: target },
  })
  assert.ifError(result.error)
  return result
}

test("excludes target commits imported after the PR opening base", (t) => {
  const repo = repository(t)
  repo.git("checkout", "-b", "pr")
  repo.commit("fix: PR change")
  repo.git("checkout", "main")
  const target = repo.commit("Invalid already merged target message")
  repo.git("checkout", "pr")
  repo.git("merge", "main", "-m", "Merge main")
  const baseline = resolvePrBaseline(repo.mergePr())

  assert.equal(baseline.target, target)
  assert.equal(baseline.commitBase, target)
  assert.match(
    repo.git("log", "--format=%s", `${repo.openingBase}..${baseline.head}`),
    /Invalid already merged/,
  )
  const messages = repo.git(
    "log",
    "--format=%s",
    `${baseline.commitBase}..${baseline.head}`,
  )
  assert.match(messages, /fix: PR change/)
  assert.doesNotMatch(messages, /Invalid already merged/)
})

test("uses the target tree for roadmap IDs when the PR is behind main", (t) => {
  const repo = repository(t)
  repo.git("checkout", "-b", "pr")
  const head = repo.commit("Invalid PR message", { "pr.txt": "PR" })
  repo.git("checkout", "main")
  const target = repo.commit("Invalid target message", {
    "docs/roadmap/platform/feat-1-a.md": ticket("feat-1"),
    "docs/roadmap/platform/feat-1-b.md": ticket("feat-1"),
  })
  const baseline = resolvePrBaseline(repo.mergePr())

  assert.equal(baseline.target, target)
  assert.equal(baseline.commitBase, repo.openingBase)
  assert.equal(baseline.head, head)
  assert.equal(
    repo.git("log", "--format=%s", `${baseline.commitBase}..${head}`),
    "Invalid PR message",
  )
  assert.equal(checkRoadmap(repo.cwd, baseline.commitBase).status, 1)
  const result = checkRoadmap(repo.cwd, baseline.target)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /No new roadmap ticket ID collisions/)
})

test("still rejects a collision introduced by the PR", (t) => {
  const repo = repository(t)
  repo.commit("docs: existing ticket", {
    "docs/roadmap/platform/feat-1-a.md": ticket("feat-1"),
  })
  repo.git("checkout", "-b", "pr")
  repo.commit("docs: duplicate ticket", {
    "docs/roadmap/platform/feat-1-b.md": ticket("feat-1"),
  })
  const baseline = resolvePrBaseline(repo.mergePr())
  const result = checkRoadmap(repo.cwd, baseline.target)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /feat-1 is used by/)
})

test("rejects a checkout that is not the expected two-parent PR merge", (t) => {
  const repo = repository(t)
  assert.throws(
    () =>
      resolvePrBaseline({
        cwd: repo.cwd,
        headSha: repo.openingBase,
        mergeSha: repo.openingBase,
      }),
    /two-parent/,
  )
  repo.git("checkout", "-b", "pr")
  repo.commit("fix: PR change")
  const context = repo.mergePr()
  assert.throws(
    () => resolvePrBaseline({ ...context, headSha: repo.openingBase }),
    /second parent/,
  )
  assert.throws(
    () => resolvePrBaseline({ ...context, mergeSha: repo.openingBase }),
    /checkout does not match/,
  )
  assert.throws(
    () => resolvePrBaseline({ ...context, headSha: "main" }),
    /40-character/,
  )
})

test("CLI emits the verified target, lint base, and PR head for workflow outputs", (t) => {
  const repo = repository(t)
  repo.git("checkout", "-b", "pr")
  repo.commit("fix: PR change")
  const context = repo.mergePr()
  const result = spawnSync(process.execPath, [resolver], {
    cwd: repo.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PR_HEAD_SHA: context.headSha,
      GITHUB_SHA: context.mergeSha,
    },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.stdout,
    `target=${repo.openingBase}\ncommit_base=${repo.openingBase}\nhead=${context.headSha}\n`,
  )
})
