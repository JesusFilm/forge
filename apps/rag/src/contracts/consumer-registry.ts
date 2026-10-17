/** Restricted registry contract. Callers must supply a server-verified GitHub ID. */
export type ConsumerRecord = {
  consumerId: string
  name: string
  state: "pending" | "active" | "suspended" | "revoked"
  allowedSourceKeys: string[]
  createdAt: Date
}

export type ConsumerMember = {
  githubUserId: string
  role: "owner" | "member"
}

export type CreateConsumer = {
  name: string
  ownerGithubUserId: string
}

export type AddConsumerMember = {
  consumerId: string
  actorGithubUserId: string
  memberGithubUserId: string
}

export type RemoveConsumerMember = AddConsumerMember

export interface ConsumerRegistry {
  create(input: CreateConsumer): Promise<ConsumerRecord>
  findById(consumerId: string): Promise<ConsumerRecord | null>
  listMembers(consumerId: string): Promise<ConsumerMember[]>
  addMember(input: AddConsumerMember): Promise<void>
  removeMember(input: RemoveConsumerMember): Promise<void>
}
