// Browser-safe executable identity pins shared by operator forms and the
// server-side request validator. Keep crypto/Node imports out of this module.
export const SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST =
  "52e1ed3fea0be2fb9165c2bb6f4fc1fb58f107f6fe1692dd828ffb95e3e7a601"
export const SUBTITLE_EVAL_PROMPT_POLICY_ID =
  "subtitle-enrichment-production-v1"
export const SUBTITLE_EVAL_ALLOWED_PROVIDER = "openrouter"
export const SUBTITLE_EVAL_ALLOWED_MODELS = ["google/gemini-2.5-flash"] as const
