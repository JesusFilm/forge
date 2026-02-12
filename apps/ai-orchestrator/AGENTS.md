# AI Orchestrator Agent Guide

Scope: `apps/ai-orchestrator`.

## Do

- Route all model-provider access through provider adapters.
- Log provenance per revision: prompt version, provider, model, confidence.
- Keep policy checks before writing outputs.
- Write only draft/variant records via CMS APIs.

## Do not

- Publish canonical content.
- Bypass moderation/review requirements.
