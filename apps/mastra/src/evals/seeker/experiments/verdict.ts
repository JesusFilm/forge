import { readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { scanExperimentPackage } from "./artifacts"
import { evaluateEligibility } from "./eligibility"
import {
  AttemptCompletionSchema,
  HypothesisCriterionSchema,
  SafeIdSchema,
  TerminalVerdictSchema,
  VerdictRecordSchema,
  type EligibilityRecord,
  type TerminalVerdict,
} from "./types"

export type RecordTerminalVerdictInput = {
  experimentsRoot: string
  experimentDir: string
  attemptId: string
  candidateId: string
  verdict: TerminalVerdict
  actor: string
  recordedAt?: string
  reasoning: string
  evidence: string[]
}

export type TerminalVerdictResult = {
  path: string
  eligibility: EligibilityRecord
  commitReady: true
}

function candidateArtifact(value: unknown, candidateId: string): unknown {
  return (value as { candidates?: Record<string, unknown> } | null)
    ?.candidates?.[candidateId]
}

export async function recordTerminalVerdict(
  input: RecordTerminalVerdictInput,
): Promise<TerminalVerdictResult> {
  SafeIdSchema.parse(input.attemptId)
  SafeIdSchema.parse(input.candidateId)
  TerminalVerdictSchema.parse(input.verdict)
  const experimentDir = resolve(input.experimentDir)
  const experimentId = basename(experimentDir)
  SafeIdSchema.parse(experimentId)
  if (experimentDir !== resolve(input.experimentsRoot, experimentId))
    throw new Error("experiment directory does not match repository identity")

  const verdictPath = join(experimentDir, "verdict.json")
  try {
    await readFile(verdictPath, "utf8")
    throw new Error(
      `experiment ${experimentId} already has a terminal verdict; start a new attempt for policy or evaluation changes`,
    )
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
  }

  await scanExperimentPackage(
    input.experimentsRoot,
    experimentId,
    input.attemptId,
  )
  const attemptDir = join(experimentDir, "attempts", input.attemptId)
  const completion = AttemptCompletionSchema.parse(
    JSON.parse(await readFile(join(attemptDir, "completion.json"), "utf8")),
  )
  const manifest = JSON.parse(
    await readFile(join(experimentDir, "experiment.json"), "utf8"),
  ) as { criterion?: unknown; candidates?: Array<{ id?: unknown }> }
  const criterion = HypothesisCriterionSchema.parse(manifest.criterion)
  if (
    !manifest.candidates?.some(
      (candidate) => candidate.id === input.candidateId,
    )
  )
    throw new Error(
      `candidate ${input.candidateId} is not declared by the experiment`,
    )

  const inventoryPaths = new Set(
    completion.inventory.artifacts.map((artifact) => artifact.path),
  )
  for (const evidence of input.evidence)
    if (!inventoryPaths.has(evidence))
      throw new Error(
        `verdict evidence is not in the completed inventory: ${evidence}`,
      )
  for (const required of ["gate-report.json", "score.json", "comparison.md"])
    if (!input.evidence.some((path) => path.endsWith(`/${required}`)))
      throw new Error(`terminal verdict requires ${required} evidence`)

  const gateFile = JSON.parse(
    await readFile(join(attemptDir, "gate-report.json"), "utf8"),
  )
  const scoreFile = JSON.parse(
    await readFile(join(attemptDir, "score.json"), "utf8"),
  )
  const gateReport = candidateArtifact(gateFile, input.candidateId)
  const score = candidateArtifact(scoreFile, input.candidateId)
  if (gateReport == null)
    throw new Error(`gate evidence is unavailable for ${input.candidateId}`)

  const eligibility = evaluateEligibility({
    gateReport,
    criterion,
    score,
    evidence: input.evidence,
  })
  if (input.verdict === "successful" && !eligibility.eligible)
    throw new Error(
      "cannot record successful for an automatically ineligible candidate; a policy change requires a new run",
    )

  const record = VerdictRecordSchema.parse({
    schemaVersion: "seeker-verdict/v1",
    experimentId,
    attemptId: input.attemptId,
    candidateId: input.candidateId,
    verdict: input.verdict,
    actor: input.actor,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    reasoning: input.reasoning,
    evidence: input.evidence,
    eligibility,
  })
  try {
    await writeFile(verdictPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `experiment ${experimentId} already has a terminal verdict`,
      )
    throw cause
  }
  return { path: verdictPath, eligibility, commitReady: true }
}
