import {
  assertTokenPolicy,
  type TokenPolicyInput,
} from "./token-policy.service"

export type OAuthPolicyInput = TokenPolicyInput & {
  membershipStatus?: "invited" | "active" | "suspended" | "disabled" | null
  appStatus: "active" | "suspended" | "archived"
  environmentStatus: "pending" | "approved" | "rejected" | "revoked"
  grantStatus: "pending" | "approved" | "rejected" | "revoked"
}

export type OAuthTokenDecision = {
  audience: string
  scopes: string[]
  family: TokenPolicyInput["family"]
}

export function authorizeOAuthTokenIssue(
  input: OAuthPolicyInput,
): OAuthTokenDecision {
  if (
    input.family === "user_delegated" &&
    input.membershipStatus !== "active"
  ) {
    throw new Error("Active membership is required for user-delegated tokens.")
  }

  if (input.appStatus !== "active") {
    throw new Error(
      `Registered app status '${input.appStatus}' cannot issue tokens.`,
    )
  }

  if (input.environmentStatus !== "approved") {
    throw new Error(
      `App environment status '${input.environmentStatus}' cannot issue tokens.`,
    )
  }

  if (input.grantStatus !== "approved") {
    throw new Error(
      `App grant status '${input.grantStatus}' cannot issue tokens.`,
    )
  }

  assertTokenPolicy(input)

  return {
    audience: input.audience,
    scopes: [...new Set(input.requestedScopes)],
    family: input.family,
  }
}
