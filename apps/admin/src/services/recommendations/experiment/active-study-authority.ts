import type { Prisma } from "@prisma/client"
import { RecommendationInternalStateError } from "../errors"
import { digestValue } from "../promotion/manifest"
import type { CowatchTrialBinding } from "../cowatch/trial-authority.service"
import type { CompositionBinding } from "../composition/service"
import type { ExperimentAssignmentContext } from "./assignment"
import type { StudyIdentity } from "./study-dependencies"
import type { StudyProtocol } from "./study-protocol"

export type ActiveStudyAuthority = Readonly<{
  execution: "semantic" | "legacy_hybrid" | "incumbent" | "cowatch_mmr"
  experimentId: string
  experimentGeneration: number
  protocolDigest: string
  challengerManifestId: string
  validUntil: Date
  cowatch: CowatchTrialBinding | null
  composition: CompositionBinding | null
}>

export const activeStudyAuthorityDigest = (authority: ActiveStudyAuthority) =>
  digestValue(JSON.parse(JSON.stringify(authority)))

/** Historical study authority cannot issue new profile-linked deliveries. */
export async function readActiveStudyAuthority(
  _tx: Prisma.TransactionClient,
  _input: { assignment: ExperimentAssignmentContext; now: Date },
): Promise<ActiveStudyAuthority | null> {
  return null
}

export async function lockActiveStudyAuthorityForIssuance(
  _tx: Prisma.TransactionClient,
  _input: {
    assignment: ExperimentAssignmentContext
    expected: ActiveStudyAuthority
    now: Date
  },
): Promise<ActiveStudyAuthority> {
  throw new RecommendationInternalStateError("active_study_authority_fenced")
}

export async function lockStudyAdmissionAuthority(
  _tx: Prisma.TransactionClient,
  _input: { protocol: StudyProtocol; identity: StudyIdentity; now: Date },
): Promise<void> {
  throw new RecommendationInternalStateError("study_source_authority_fenced")
}
