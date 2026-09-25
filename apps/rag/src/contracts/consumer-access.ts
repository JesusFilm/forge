import type { ConsumerRecord, ConsumerMember } from "./consumer-registry.js"

export class ConsumerAccessError extends Error {
  override readonly name = "ConsumerAccessError"
  constructor(readonly code: "invalid" | "forbidden" | "missing" | "conflict") {
    super(code)
  }
}

export type IssuedConsumer = { consumer: ConsumerRecord; secret: string }
export type ConsumerDirectoryEntry = ConsumerRecord & {
  owned: boolean
  credentialVersion: number
  membershipVersion: number
}

export type ConsumerMutation = {
  consumerId: string
  actorGithubUserId: string
  admissionSha?: string
  verifyCurrentAdmission?(): Promise<boolean>
}
export type VersionedConsumerMutation = ConsumerMutation & {
  expectedVersion: number
}
export type AddConsumerMemberMutation = VersionedConsumerMutation & {
  memberGithubUserId: string
  verifyCurrentEligibility(): Promise<string | null>
}
export type RemoveConsumerMemberMutation = VersionedConsumerMutation & {
  memberGithubUserId: string
}
export type RotateConsumerCredential = VersionedConsumerMutation & {
  reason?: "routine" | "lost"
}
export type TransitionConsumer = ConsumerMutation & {
  state: "active" | "suspended" | "revoked"
}

/** The caller's ID comes only from a freshly admitted portal session. */
export type ConsumerAccess = {
  recordAllowlistRevision(sha: string): Promise<void>
  list(actorGithubUserId: string): Promise<ConsumerDirectoryEntry[]>
  create(input: {
    name: string
    actorGithubUserId: string
    allowedSourceKeys: string[]
    admissionSha?: string
  }): Promise<IssuedConsumer>
  members(
    consumerId: string,
    actorGithubUserId: string,
  ): Promise<ConsumerMember[]>
  addMember(input: AddConsumerMemberMutation): Promise<void>
  removeMember(input: RemoveConsumerMemberMutation): Promise<void>
  rotate(
    input: RotateConsumerCredential,
  ): Promise<{ secret: string; credentialVersion: number }>
  transition(input: TransitionConsumer): Promise<void>
}

export type AuthenticatedConsumer = {
  consumerId: string
  allowedSourceKeys: string[]
}

export type ConsumerAuthenticator = {
  authenticate(secret: string): Promise<AuthenticatedConsumer | null>
}
