// Browser-safe executable identity pins shared by operator forms and the
// server-side request validator. Keep crypto/Node imports out of this module.
export const SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST =
  "12ed5350c47fee269ba8a8bdaec70b635e177691238f9749071cb4b50412a22d"
export const SUBTITLE_EVAL_PROMPT_POLICY_ID =
  "subtitle-enrichment-production-v1"
export const SUBTITLE_EVAL_ALLOWED_PROVIDER = "openrouter"
export const SUBTITLE_EVAL_ALLOWED_MODELS = ["google/gemini-2.5-flash"] as const
