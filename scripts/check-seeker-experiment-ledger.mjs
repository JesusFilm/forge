#!/usr/bin/env node
// Enforces the Git ledger's append-only boundary across a base/head tree pair.
// Existing evidence bytes never change. An unterminated experiment may gain a
// genuinely new attempt or its one terminal verdict; a verdict seals the whole
// experiment. Dependency-free so the required CI check needs no install.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const LEDGER_ROOT = "apps/mastra/evals/experiments"
const MUTABLE_ROOT_FILES = new Set(["README.md", "experiment.template.json"])
const EXPERIMENT_ID = /^\d{4}-\d{2}-\d{2}-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/
// Mirrors SafeIdSchema without importing the TypeScript application runtime.
const ATTEMPT_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

function splitPath(path) {
  const [experimentId, ...rest] = path.split("/")
  return { experimentId, rest }
}

export function findLedgerViolations(baseEntries, headEntries) {
  const violations = []

  for (const [path, baseObject] of baseEntries) {
    if (MUTABLE_ROOT_FILES.has(path)) continue
    const { experimentId } = splitPath(path)
    if (!EXPERIMENT_ID.test(experimentId)) continue
    const headObject = headEntries.get(path)
    if (headObject !== baseObject) {
      const change = headObject == null ? "deleted or renamed" : "modified"
      violations.push(
        `${change} historical experiment file: ${LEDGER_ROOT}/${path}`,
      )
    }
  }

  const baseExperiments = new Set()
  const sealedExperiments = new Set()
  const baseAttempts = new Map()
  for (const path of baseEntries.keys()) {
    const { experimentId, rest } = splitPath(path)
    if (!EXPERIMENT_ID.test(experimentId)) continue
    baseExperiments.add(experimentId)
    if (rest.join("/") === "verdict.json") sealedExperiments.add(experimentId)
    if (rest[0] === "attempts" && rest[1]) {
      const attempts = baseAttempts.get(experimentId) ?? new Set()
      attempts.add(rest[1])
      baseAttempts.set(experimentId, attempts)
    }
  }

  for (const path of headEntries.keys()) {
    if (baseEntries.has(path) || MUTABLE_ROOT_FILES.has(path)) continue
    const { experimentId, rest } = splitPath(path)
    if (!EXPERIMENT_ID.test(experimentId)) {
      violations.push(
        `unexpected experiment-ledger addition: ${LEDGER_ROOT}/${path}`,
      )
      continue
    }
    if (!baseExperiments.has(experimentId)) continue
    if (sealedExperiments.has(experimentId)) {
      violations.push(
        `addition to experiment sealed by terminal verdict: ${LEDGER_ROOT}/${path}`,
      )
      continue
    }
    if (rest.join("/") === "verdict.json") continue
    const attemptId = rest[0] === "attempts" ? rest[1] : undefined
    if (rest.length < 3 || attemptId == null || !ATTEMPT_ID.test(attemptId)) {
      violations.push(
        `unexpected addition to existing experiment: ${LEDGER_ROOT}/${path}`,
      )
      continue
    }
    if (baseAttempts.get(experimentId)?.has(attemptId)) {
      violations.push(
        `addition to existing attempt; create a new attempt ID: ${LEDGER_ROOT}/${path}`,
      )
    }
  }

  return violations.sort()
}

function argument(name, fallback) {
  const prefix = `--${name}=`
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  )
}

function gitTree(ref) {
  const commit = execFileSync(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { encoding: "utf8" },
  ).trim()
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", commit, "--", LEDGER_ROOT],
    { encoding: "utf8" },
  )
  const entries = new Map()
  for (const record of output.split("\0")) {
    if (!record) continue
    const [metadata, path] = record.split("\t")
    const object = metadata.split(" ")[2]
    const prefix = `${LEDGER_ROOT}/`
    if (path?.startsWith(prefix) && object)
      entries.set(path.slice(prefix.length), object)
  }
  return { commit, entries }
}

function main() {
  const base = argument("base", "origin/main")
  const head = argument("head", "HEAD")
  const baseTree = gitTree(base)
  const headTree = gitTree(head)
  const baseEntries = baseTree.entries
  const headEntries = headTree.entries
  const violations = findLedgerViolations(baseEntries, headEntries)

  if (violations.length > 0) {
    console.error(
      `Seeker experiment ledger guard FAILED (${baseTree.commit.slice(0, 12)}..${headTree.commit.slice(0, 12)}):\n` +
        violations.map((value) => `  - ${value}`).join("\n") +
        "\n\nHistorical experiment bytes are immutable after merge. " +
        "Create a new attempt or a new experiment instead.",
    )
    process.exit(1)
  }

  const additions = [...headEntries.keys()].filter(
    (path) => !baseEntries.has(path),
  ).length
  console.log(
    `Seeker experiment ledger guard OK (${baseTree.commit.slice(0, 12)}..${headTree.commit.slice(0, 12)}) — ${baseEntries.size} base file(s) preserved; ${additions} addition(s) accepted.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main()
