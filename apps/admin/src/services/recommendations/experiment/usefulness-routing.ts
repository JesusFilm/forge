import type { Prisma, PrismaClient } from "@prisma/client"
import { RecommendationInternalStateError } from "../errors"
import type {
  ExperimentAssignmentContext,
  ExperimentAssignmentResolution,
} from "./assignment"

/** Historical profile cohorts cannot enroll after behavioral retirement. */
export async function assignProfileUsefulnessExperiment(
  _prisma: PrismaClient,
  _input: {
    sessionDigest: string
    profileTokenDigest: string
    eligibleForEnrollment: boolean
    clientDeliveryContract?: string | null
    now: Date
    deadlineAt: number
  },
): Promise<ExperimentAssignmentResolution> {
  return { assignment: null, bypassReason: "personalization_not_consented" }
}

export async function lockProfileUsefulnessAssignment(
  _tx: Prisma.TransactionClient,
  _input: {
    assignment: ExperimentAssignmentContext
    profileTokenDigest: string
    now: Date
  },
): Promise<never> {
  throw new RecommendationInternalStateError("experiment_assignment_fenced")
}
