/**
 * Fixed, non-PII reason codes for chat's auth path. The callback logs these
 * (never the caught error's message, which can embed token/claim fragments —
 * KTD7) and the R12 failure notice is keyed off the same fixed enum, never free
 * text.
 */
export type ChatAuthErrorCode =
  | "config_missing"
  | "id_token_missing"
  | "id_token_invalid"
  // Distinct id_token verify-failure codes (never claim VALUES, only the failure
  // kind) so a deploy-time misconfig — wrong client id (aud) or issuer — is
  // greppable instead of hiding in ordinary-looking token churn (R9 alarm).
  | "id_token_expired"
  | "id_token_aud_mismatch"
  | "id_token_iss_mismatch"
  | "id_token_claim_mismatch"
  | "id_token_signature_invalid"
  // Token's alg isn't in the JWKS-derived allowlist (a forged/unsupported alg,
  // or a rotation not yet picked up within the re-derive cooldown). Distinct so
  // it's greppable, not buried in generic id_token_invalid churn (R9/KTD3).
  | "id_token_alg_not_allowed"
  | "jwks_unavailable"
  | "token_exchange_failed"
  | "state_mismatch"
  | "missing_verifier"

/** A typed auth-path error carrying a fixed, loggable, non-PII `code`. */
export class ChatAuthError extends Error {
  readonly code: ChatAuthErrorCode

  constructor(code: ChatAuthErrorCode, message?: string) {
    super(message ?? code)
    this.name = "ChatAuthError"
    this.code = code
  }
}

/** The fixed reason code for any thrown value, defaulting to a generic code. */
export function chatAuthErrorCode(error: unknown): string {
  return error instanceof ChatAuthError ? error.code : "callback_failed"
}
