import type { Route } from "next"

/**
 * Identity of one Admin-origin SEO proposal confirmation. Every field binds
 * the decision: the proposal id, its immutable version and payload digest,
 * and the action the Admin chose on Watch. Nothing here carries authority —
 * the actor comes from the live Admin session and the nonce is server-minted.
 */
export const CONFIRM_PATH = "/dashboard/seo/proposals/confirm"

export type ConfirmationDecision = "apply" | "decline"

export type ConfirmationIdentity = {
  proposalId: string
  version: number
  payloadDigest: string
  decision: ConfirmationDecision
}

/** Closed outcome codes carried in the redirect URL. No free text, no ids. */
export const CONFIRMATION_RESULTS = [
  "APPROVED",
  "REJECTED",
  "STALE",
  "CONFLICT",
  "ALREADY_DECIDED",
  "EXPIRED",
  "MISMATCH",
  "REPLAY",
  "REASON_REQUIRED",
  "INVALID",
  "RETRY",
  "ERROR",
] as const

export type ConfirmationResult = (typeof CONFIRMATION_RESULTS)[number]

// Mirrors the ledger's bounded proposal id: 1-191 chars, no control chars,
// no surrounding whitespace.
function isBoundedProposalId(value: string): boolean {
  if (value.length < 1 || value.length > 191) return false
  if (value.trim() !== value) return false
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}
const DIGEST = /^[a-f0-9]{64}$/
const VERSION = /^[1-9][0-9]{0,8}$/

type RawValue = string | string[] | null | undefined | File

function single(value: RawValue): string | null {
  if (Array.isArray(value)) return null
  return typeof value === "string" ? value : null
}

export function parseConfirmationIdentity(raw: {
  proposalId?: RawValue
  version?: RawValue
  payloadDigest?: RawValue
  decision?: RawValue
}): ConfirmationIdentity | null {
  const proposalId = single(raw.proposalId)
  const version = single(raw.version)
  const payloadDigest = single(raw.payloadDigest)
  const decision = single(raw.decision)
  if (!proposalId || !isBoundedProposalId(proposalId)) return null
  if (!version || !VERSION.test(version)) return null
  if (!payloadDigest || !DIGEST.test(payloadDigest)) return null
  if (decision !== "apply" && decision !== "decline") return null
  return {
    proposalId,
    version: Number(version),
    payloadDigest,
    decision,
  }
}

export function parseConfirmationResult(
  value: RawValue,
): ConfirmationResult | null {
  const result = single(value)
  return (CONFIRMATION_RESULTS as readonly string[]).includes(result ?? "")
    ? (result as ConfirmationResult)
    : null
}

export function confirmationHref(
  identity: ConfirmationIdentity,
  result?: ConfirmationResult,
): Route {
  const query = new URLSearchParams({
    proposalId: identity.proposalId,
    version: String(identity.version),
    payloadDigest: identity.payloadDigest,
    decision: identity.decision,
  })
  if (result) query.set("result", result)
  return `${CONFIRM_PATH}?${query.toString()}` as Route
}
