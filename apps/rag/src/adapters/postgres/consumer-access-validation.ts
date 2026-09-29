import { ConsumerAccessError } from "../../contracts/consumer-access.js"
import type { ConsumerRecord } from "../../contracts/consumer-registry.js"

export type ConsumerRow = {
  id: string
  name: string
  state: ConsumerRecord["state"]
  allowed_source_keys: string[]
  created_at: Date
  credential_version: bigint
  membership_version: bigint
  lifecycle_version: bigint
  member_count?: bigint
  owned?: boolean
}

export const consumerRecord = (row: ConsumerRow): ConsumerRecord => ({
  consumerId: row.id,
  name: row.name,
  state: row.state,
  allowedSourceKeys: row.allowed_source_keys,
  createdAt: row.created_at,
})

export const githubId = (id: string): string => {
  if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
    throw new ConsumerAccessError("invalid")
  return id
}

export const consumerId = (id: string): string => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new ConsumerAccessError("invalid")
  return id
}

export const uniqueConflict = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false
  const value = error as { code?: string; meta?: { code?: string } }
  return (
    value.code === "P2002" ||
    (value.code === "P2010" && value.meta?.code === "23505")
  )
}
