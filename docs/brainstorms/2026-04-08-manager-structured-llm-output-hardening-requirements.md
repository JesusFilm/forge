---
date: 2026-04-08
topic: manager-structured-llm-output-hardening
---

# Manager Structured LLM Output Hardening

## Problem Frame

We already proved that raw "return valid JSON" prompting is too fragile for the manager's OpenRouter-backed workflows. A real local enrich run failed because chapters and metadata came back wrapped or malformed, even though the semantic content was good. We fixed those two services by switching to a shared structured-output helper with strict JSON schema requests, OpenRouter response healing, and Zod validation.

The remaining JSON-shaped LLM path in `apps/manager` is subtitle retiming. It still uses `response_format: { type: "json_object" }` plus direct `JSON.parse`, which leaves it exposed to the same class of failures. At the same time, the older `parseLLMJson` helper now appears unused, and manager docs still describe the old pattern.

## Requirements

- R1. Subtitle retiming must use the same shared structured-output boundary as chapters and metadata.
- R2. Retiming must continue validating against `RetimingOutputSchema` before accepting an LLM result.
- R3. The current correction loop and deterministic fallback behavior in retiming must remain intact.
- R4. Dead JSON-parsing utilities should be removed once no runtime callers remain.
- R5. Manager-facing docs should explicitly direct future object-shaped LLM requests through the shared structured-output helper instead of ad hoc raw JSON parsing.

## Success Criteria

- `retimer.ts` no longer depends on `json_object` + manual `JSON.parse`.
- All manager JSON/object LLM requests flow through the shared helper in `openrouter.ts`.
- The subtitle translation pipeline still preserves its existing retry/correction/fallback behavior.
- `parseLLMJson.ts` is either removed or clearly retained for a real remaining caller.
- Manager tests, lint, and typecheck all pass after the migration.

## Scope Boundaries

- Plain-text generation paths, such as `translator.ts`, are not in scope unless they are later converted to structured outputs for a separate product reason.
- Embeddings are not in scope.
- No attempt to standardize non-manager apps in this pass.
- No new generic lint rule or repo-wide guardrail in this pass.

## Key Decisions

- **Shared helper over one-off fixes**: Reuse the `openrouter.ts` structured-output helper so JSON/object LLM behavior is centralized.
- **Retimer is the only remaining migration target**: Current repo scan shows it is the last manager runtime path still relying on raw JSON parsing from an LLM response.
- **Keep existing fallback semantics**: The retiming pipeline already has a good safety model; we only want to harden the structured-output boundary, not redesign the workflow.
- **Document the pattern explicitly**: If docs are not updated, future JSON-shaped LLM code will likely regress back to raw prompting and manual parsing.

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Implementation detail] Should structured-output parse failures in retiming count as normal correction-loop failures, or should they short-circuit differently from semantic validation errors?
- [Affects R5][Docs] Should the new manager guidance live only in `apps/manager/AGENTS.md`, or also in `apps/manager/CLAUDE.md` if that file contains AI service conventions?

## Next Steps

-> `/ce:plan` for structured implementation planning
