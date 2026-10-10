/**
 * Seeker eval — identity hash material shared by the runners.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

import { criteriaFor, type Question } from "./questions"
import {
  CLASS_WEIGHTS,
  CRITERION_CLASSES,
  WEIGHTS_VERSION,
  type CriterionClass,
} from "./weights"

/**
 * Hash the exact criteria under test — text, polarity, AND section tags —
 * so editing a rubric (or re-tagging a criterion) breaks run comparability.
 */
export function criteriaHash(questions: readonly Question[]): string {
  const material = questions
    .map((question) =>
      criteriaFor(question)
        .map(
          (criterion) =>
            `${question.id}|${criterion.id}|${criterion.polarity}|${[
              ...criterion.promptSections,
            ].join("+")}|${criterion.text}`,
        )
        .join("\n"),
    )
    .join("\n")
  return createHash("sha256").update(material).digest("hex")
}

export function sha256(material: string): string {
  return createHash("sha256").update(material).digest("hex")
}

/**
 * Hash the weighting scheme a judge run's verdicts are SCORED under —
 * `WEIGHTS_VERSION` + every criterion's class + every class's weight. The
 * criterion classes decide which gate lane a verdict flip lands in
 * (grounding = red-capable, tone/doctrine = triage), so a same-PR
 * reclassification silently changes what the gate means; stamping this into
 * run identity at judge time makes it a refusal dimension instead. Entries
 * are key-sorted so object-literal ordering can never move the hash. The
 * material parameters are injectable ONLY for sensitivity tests —
 * production callers use the defaults.
 */
export function weightsHash(
  material: {
    version?: string
    classes?: Readonly<Record<string, CriterionClass>>
    weights?: Readonly<Record<string, number>>
  } = {},
): string {
  const version = material.version ?? WEIGHTS_VERSION
  const classes = material.classes ?? CRITERION_CLASSES
  const weights = material.weights ?? CLASS_WEIGHTS
  const sortedEntries = (record: Readonly<Record<string, unknown>>): string[] =>
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
  return sha256(
    [version, ...sortedEntries(classes), ...sortedEntries(weights)].join("\n"),
  )
}

export function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
}
