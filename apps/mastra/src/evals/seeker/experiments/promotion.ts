import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"
import { promisify } from "node:util"

import {
  AttemptCompletionSchema,
  ResolvedIdentitySchema,
  VerdictRecordSchema,
  type ResolvedIdentity,
} from "./types"
import { SEEKER_PRODUCTION_PROMPT } from "../../../mastra/agents/seeker-production-config"

const exec = promisify(execFile)
const BENCHMARK_FILES = [
  "answers.json",
  "transcripts.json",
  "judged.json",
  "score.json",
] as const

export type PromotionInput = {
  repositoryRoot: string
  experimentPath: string
  attemptId: string
  candidateId: string
  evidenceCommit: string
  proposedIdentity: ResolvedIdentity
  benchmarkDir: string
  materialize: boolean
  productionPrompt?: {
    provider: string
    name: string
    revision: string
    contentHash: string
  }
}

export type PromotionResult = {
  valid: boolean
  requiresFreshRun: boolean
  mismatches: string[]
  source: {
    experimentId: string
    attemptId: string
    candidateId: string
    commit: string
  }
  materializedFiles: string[]
}

function relativeInside(root: string, path: string): string {
  const absoluteRoot = resolve(root)
  const absolute = resolve(root, path)
  if (
    absolute === absoluteRoot ||
    !absolute.startsWith(`${absoluteRoot}${sep}`)
  )
    throw new Error("promotion path must remain inside the repository")
  return absolute
    .slice(absoluteRoot.length + 1)
    .split(sep)
    .join("/")
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    return (await exec("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 }))
      .stdout
  } catch {
    throw new Error(`promotion Git validation failed: git ${args[0]}`)
  }
}

function identityMismatches(
  accepted: ResolvedIdentity,
  proposed: ResolvedIdentity,
): string[] {
  const keys = [
    "prompt",
    "model",
    "decoding",
    "questionSet",
    "criteria",
    "judge",
    "retrieval",
    "runtime",
  ] as const
  return keys.filter(
    (key) => JSON.stringify(accepted[key]) !== JSON.stringify(proposed[key]),
  )
}

/** Read-only validation precedes every write; source evidence is read from Git, never trusted from disk. */
export async function preparePromotion(
  input: PromotionInput,
): Promise<PromotionResult> {
  const root = resolve(input.repositoryRoot)
  const experimentPath = relativeInside(root, input.experimentPath)
  const benchmarkPath = resolve(root, input.benchmarkDir)
  relativeInside(root, benchmarkPath)
  await git(root, ["cat-file", "-e", `${input.evidenceCommit}^{commit}`])
  await git(root, ["merge-base", "--is-ancestor", input.evidenceCommit, "HEAD"])
  if ((await git(root, ["status", "--porcelain", "--", experimentPath])).trim())
    throw new Error(
      "promotion source experiment must be clean and fully committed",
    )

  const source = {
    experimentId: basename(experimentPath),
    attemptId: input.attemptId,
    candidateId: input.candidateId,
    commit: input.evidenceCommit,
  }
  const attempt = `${experimentPath}/attempts/${input.attemptId}`
  const paths = [
    `${experimentPath}/verdict.json`,
    `${attempt}/completion.json`,
    `${attempt}/resolved-identity.json`,
    ...BENCHMARK_FILES.map((name) => `${attempt}/${name}`),
  ]
  const committed = new Map<string, string>()
  for (const path of paths) {
    const value = await git(root, ["show", `${input.evidenceCommit}:${path}`])
    committed.set(path, value)
    let working: string
    try {
      working = await readFile(join(root, path), "utf8")
    } catch {
      throw new Error(
        `promotion evidence is missing from the working tree: ${path}`,
      )
    }
    if (working !== value)
      throw new Error(
        `promotion evidence differs from committed revision: ${path}`,
      )
  }

  const verdict = VerdictRecordSchema.parse(
    JSON.parse(committed.get(paths[0])!),
  )
  if (
    verdict.experimentId !== source.experimentId ||
    verdict.attemptId !== input.attemptId ||
    verdict.candidateId !== input.candidateId
  )
    throw new Error(
      "terminal verdict does not identify the requested promotion candidate",
    )
  if (verdict.verdict !== "successful")
    throw new Error("promotion requires a successful terminal verdict")
  if (
    !verdict.eligibility.eligible ||
    verdict.eligibility.gate.outcome !== "green" ||
    verdict.eligibility.criterion.outcome !== "passed"
  )
    throw new Error("promotion candidate is not automatically eligible")

  const completion = AttemptCompletionSchema.parse(
    JSON.parse(committed.get(paths[1])!),
  )
  if (
    completion.experimentId !== source.experimentId ||
    completion.attemptId !== input.attemptId
  )
    throw new Error("attempt completion does not identify the promotion source")
  for (const artifact of completion.inventory.artifacts) {
    const artifactPath = `${experimentPath}/${artifact.path}`
    const content = await git(root, [
      "show",
      `${input.evidenceCommit}:${artifactPath}`,
    ])
    if (createHash("sha256").update(content).digest("hex") !== artifact.sha256)
      throw new Error(
        `committed experiment inventory checksum mismatch: ${artifact.path}`,
      )
    if ((await readFile(join(root, artifactPath), "utf8")) !== content)
      throw new Error(
        `promotion evidence differs from committed revision: ${artifactPath}`,
      )
  }
  const resolved = JSON.parse(committed.get(paths[2])!) as {
    candidates?: Record<string, unknown>
  }
  const accepted = ResolvedIdentitySchema.parse(
    resolved.candidates?.[input.candidateId],
  )
  const proposed = ResolvedIdentitySchema.parse(input.proposedIdentity)
  if (
    JSON.stringify(proposed.prompt) !==
    JSON.stringify(input.productionPrompt ?? SEEKER_PRODUCTION_PROMPT)
  )
    throw new Error(
      "proposed identity does not match the repository production prompt pin",
    )
  const mismatches = identityMismatches(accepted, proposed)
  if (mismatches.length > 0)
    return {
      valid: false,
      requiresFreshRun: true,
      mismatches,
      source,
      materializedFiles: [],
    }
  if (!input.materialize)
    return {
      valid: true,
      requiresFreshRun: false,
      mismatches: [],
      source,
      materializedFiles: [],
    }

  const temporary = `${benchmarkPath}.promotion-${process.pid}-${crypto.randomUUID()}`
  await mkdir(temporary, { recursive: true })
  try {
    for (const [index, name] of BENCHMARK_FILES.entries()) {
      const aggregate = JSON.parse(committed.get(paths[index + 3])!) as {
        candidates?: Record<string, unknown>
      }
      const artifact = aggregate.candidates?.[input.candidateId]
      if (artifact == null)
        throw new Error(
          `promotion evidence is missing candidate artifact: ${name}`,
        )
      await writeFile(
        join(temporary, name),
        `${JSON.stringify({ ...(artifact as Record<string, unknown>), sourcePromotion: source }, null, 2)}\n`,
        "utf8",
      )
    }
    await mkdir(dirname(benchmarkPath), { recursive: true })
    await rm(benchmarkPath, { recursive: true, force: true })
    await rename(temporary, benchmarkPath)
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true })
    throw cause
  }
  return {
    valid: true,
    requiresFreshRun: false,
    mismatches: [],
    source,
    materializedFiles: BENCHMARK_FILES.map((name) => join(benchmarkPath, name)),
  }
}
