import { buildAuditEvent, hashAuditSubject } from "./audit.service"

export type TokenHint = "access_token" | "refresh_token" | undefined

export type RevocationPolicyInput = {
  requesterClientId: string
  tokenClientId: string
  tokenStatus: "active" | "expired" | "revoked"
}

export function normalizeTokenHint(
  value: string | null | undefined,
): TokenHint {
  if (value === "access_token" || value === "refresh_token") {
    return value
  }

  return undefined
}

export function assertCanRevokeToken(input: RevocationPolicyInput) {
  if (input.requesterClientId !== input.tokenClientId) {
    throw new Error(
      "OAuth clients can only revoke tokens issued to themselves.",
    )
  }

  if (input.tokenStatus === "revoked") {
    return
  }
}

export function buildTokenRevocationAuditEvent({
  actorUserId,
  appId,
  clientId,
  token,
  tokenHint,
}: {
  actorUserId?: string | null
  appId?: string | null
  clientId: string
  token: string
  tokenHint?: TokenHint
}) {
  return buildAuditEvent({
    eventType: "oauth.token.revoked",
    severity: "info",
    actorUserId,
    appId,
    subject: clientId,
    metadata: {
      clientId,
      tokenHash: hashAuditSubject(token),
      tokenHint,
      token: "[redacted]",
    },
  })
}
