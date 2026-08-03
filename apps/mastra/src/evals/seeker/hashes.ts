/**
 * Seeker eval — identity hash material shared by the runners.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

import { criteriaFor, type Question } from "./questions"

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

export function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
}
