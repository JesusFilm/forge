---
id: "feat-066"
title: "LLM Steering System (RAG + Guardrails)"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-10-15"
duration: 78
depends_on:
  - "feat-049"
blocks:
  - "feat-067"
  - "feat-070"
tags:
  - "ai-pipeline"
  - "platform"
  - "guardrails"
---

## Problem

As more AI generation flows go live, prompt quality alone is not enough to keep the system aligned, factual, and controllable. We need a shared steering layer for retrieval, policy grounding, and guardrails so every generation path does not reinvent safety and context handling independently.

## Entry Points — Read These First

1. `apps/manager/src/services/openrouter.ts` — current model client integration
2. `apps/manager/src/lib/parseLLMJson.ts` — output validation helper
3. `apps/manager/src/services/metadata.ts` — structured generation example
4. `apps/manager/src/services/chapters.ts` — another prompt-driven analysis path
5. `docs/roadmap/media-generation/feat-049-alternative-transcription-and-translation-models.md` — model/provider findings

## Grep These

- `openrouter` in `apps/manager/src/`
- `parseLLMJson` in `apps/manager/src/`
- `role: "system"` in `apps/manager/src/services/`
- `vector|embedding` in `docs/roadmap/`

## What To Build

1. Define a shared steering layer for retrieval inputs, policy prompts, output validation, and guardrail enforcement.
2. Decide where RAG context comes from and how generation calls declare what context they require.
3. Add instrumentation so failures can be traced to retrieval issues, prompt issues, or model behavior.
4. Keep the steering system reusable across transcription-adjacent work, generation work, and future public AI surfaces.

## Constraints

- Do NOT copy-paste guardrails into every service file as drifting prompt text.
- Keep the system inspectable; operators should be able to tell why a generation was allowed or blocked.
- Prefer incremental adoption over a giant all-at-once rewrite.

## Verification

- At least two different AI workflows can use the same steering primitives
- Retrieval context and guardrail outcomes are visible in logs or artifacts
- Unsafe or malformed outputs are caught before they reach downstream consumers
