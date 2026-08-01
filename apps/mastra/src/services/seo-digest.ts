import { createHash } from "node:crypto"

export function stableSeoJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSeoJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSeoJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function digestSeoValue(value: unknown): string {
  return createHash("sha256").update(stableSeoJson(value)).digest("hex")
}

export function seoProposalPayload(value: object): Record<string, unknown> {
  const immutablePayload: Record<string, unknown> = { ...value }
  delete immutablePayload.proposalId
  delete immutablePayload.payloadDigest
  delete immutablePayload.semanticConflictKey
  return immutablePayload
}

export function digestSeoProposalPayload(value: object): string {
  return digestSeoValue(seoProposalPayload(value))
}
