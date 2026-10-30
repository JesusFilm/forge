import type { Prisma } from "@prisma/client"
import { RecommendationInputError } from "../errors"
import {
  parseStudyProtocol,
  studyMatchesIncumbent,
  type StudyProtocol,
} from "./study-protocol"

/** Profile usefulness studies are historic; no current authority may be issued. */
export async function readStudyEvaluationAuthority(
  _tx: Prisma.TransactionClient,
  _input: {
    evaluationId: string
    purpose: "calibration" | "advancement"
    now: Date
  },
): Promise<null> {
  return null
}

export async function assertStudyAuthority(
  _tx: Prisma.TransactionClient,
  _input: {
    evaluationId: string
    purpose: "calibration" | "advancement"
    now: Date
  },
): Promise<never> {
  throw new RecommendationInputError("Behavioral study authority is retired")
}

/** Comparator matching is independent of a PASS label. Semantic A/A can never
 * authorize a trial against the live profile + viewing-mode incumbent. */
export function calibrationMatchesProtocol(
  authority: {
    study: { protocol: unknown }
    evaluation: { evaluatedAt: Date }
    expiresAt: Date
  },
  protocol: StudyProtocol,
): boolean {
  const calibration = parseStudyProtocol(authority.study.protocol)
  return (
    calibration.comparison ===
      (studyMatchesIncumbent(protocol) ? "incumbent-aa" : "semantic-aa") &&
    calibration.controlManifestId === protocol.controlManifestId &&
    calibration.controlManifestDigest === protocol.controlManifestDigest &&
    calibration.controlExecution === protocol.controlExecution &&
    calibration.identity === protocol.identity &&
    calibration.cohort === protocol.cohort &&
    calibration.surface === protocol.surface &&
    Date.parse(calibration.endsAt) + 30 * 3_600_000 <=
      Date.parse(protocol.startsAt) &&
    authority.expiresAt.getTime() >
      Date.parse(protocol.endsAt) + 30 * 3_600_000 &&
    (!protocol.cowatch ||
      authority.evaluation.evaluatedAt.getTime() ===
        Date.parse(protocol.cowatch.calibrationCompletedAt))
  )
}
export async function assertCalibrationForProtocol(
  tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  now: Date,
) {
  const authority = await assertStudyAuthority(tx, {
    evaluationId: protocol.calibrationEvaluationId!,
    purpose: "calibration",
    now,
  })
  if (!calibrationMatchesProtocol(authority, protocol))
    throw new RecommendationInputError(
      "Calibration comparator or validity horizon does not match this study",
    )
  return authority
}
