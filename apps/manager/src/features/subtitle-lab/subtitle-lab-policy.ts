// Browser-safe executable identity pins shared by operator forms and the
// server-side request validator. Keep crypto/Node imports out of this module.
export const SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST =
  "3e46dd8c3b82e3b32560d5a645c08f5b2795284e3cc997b50cc68a96dc243f62"
export const SUBTITLE_EVAL_PROMPT_POLICY_ID =
  "subtitle-enrichment-production-v1"
export const SUBTITLE_EVAL_ALLOWED_PROVIDER = "openrouter"
export const SUBTITLE_EVAL_ALLOWED_MODELS = ["google/gemini-2.5-flash"] as const
