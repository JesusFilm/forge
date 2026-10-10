---
title: "Manager Agents target-subtitle contract and language labels"
category: integration-issues
module: Manager
date: 2026-04-12
problem_type: integration_issue
component: service_object
symptoms:
  - "Target subtitle automations could collapse multiple target languages into one aggregate ownership decision"
  - "Malformed targetLanguageIds payloads could reach enqueue or persistence boundaries before failing later"
  - "Automation list rows showed raw target language core IDs instead of readable language names"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - manager
  - cms
  - agents
  - automations
  - target-subtitles
  - language-labels
  - validation
affected_components:
  - apps/manager/src/features/agents/automation-runner.ts
  - apps/manager/src/features/agents/eligibility.ts
  - apps/manager/src/app/api/automations/runs/[id]/enqueue/route.ts
  - apps/manager/src/features/agents/automation-list.tsx
  - apps/manager/src/features/agents/automation-list-presenter.ts
  - apps/manager/src/features/agents/agents-page.tsx
  - apps/cms/src/api/enrichment-automation/content-types/enrichment-automation/lifecycles.ts
  - apps/cms/src/api/enrichment-automation/services/validation.ts
related_docs:
  - docs/plans/2026-04-12-feat-manager-agents-automations-plan.md
  - docs/roadmap/media-generation/feat-084-manager-agents-automations.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
---

# Manager Agents Target-Subtitle Contract And Language Labels

## Problem

Target subtitle automations carried a list of target language IDs, but V1 coverage and ownership checks were only safe when there was exactly one target language. If the selected set mixed human-owned, AI-owned, and missing subtitle states, a single aggregate ownership decision could either enqueue human-owned output or skip refreshable AI-owned output.

The saved automation list had a separate operator-facing symptom: it rendered raw core IDs such as `529`, so users could not easily verify the language selected in the create modal after the automation was saved.

## What Didn't Work

### Letting multi-language target subtitle payloads no-op in the runner

The runner guard prevented some unsafe execution, but the service boundary could still accept malformed or multi-language payloads and turn contract drift into a later no-op. That made invalid scheduler or CMS state harder to diagnose.

### Treating target subtitle coverage like one aggregate owner

For source subtitles or metadata, one owner decision per video is enough. Target subtitles are different because ownership belongs to the specific target language. A single human-owned language in a selected set must not protect or block every other target language in that set.

### Rendering persisted IDs directly

Joining `targetLanguageIds` was technically stable but not operator-readable. The create flow already loaded language metadata, so the list view did not need to expose raw IDs as the primary display.

## Solution

For V1, keep the invariant deliberately small:

> One target subtitle automation, one target language, one ownership decision.

That avoids pretending the current aggregate coverage query is a per-language ownership model. If multi-language target subtitle automation is added later, the eligibility model must return ownership per language and dispatch only the missing or refreshable AI-owned languages.

### Reject invalid target-language shapes at boundaries

The Manager service enqueue route now treats `targetLanguageIds` as an explicit string-array contract and rejects target subtitle automations unless exactly one target language is present:

```typescript
const automationPayloadSchema = z.object({
  targetLanguageIds: z
    .array(z.string().trim().min(1))
    .max(20)
    .default([])
    .transform((languageIds) => Array.from(new Set(languageIds))),
})

if (
  parsed.data.automation.template === "target_subtitles_missing" &&
  parsed.data.automation.targetLanguageIds.length !== 1
) {
  return NextResponse.json(
    {
      error: "Validation failed",
      details: ["Choose one target language for subtitle automations."],
    },
    { status: 400 },
  )
}
```

The CMS lifecycle validation mirrors the same invariant at the persistence boundary so direct Strapi writes cannot save malformed automation shapes:

```typescript
if (
  input.template === "target_subtitles_missing" &&
  input.targetLanguageIds.length !== 1
) {
  return ["target_subtitles_missing requires exactly one target language"]
}
```

### Keep the runner defensive

The runner still treats target subtitles as a one-language contract before coverage is fetched. That defense matters because persisted automation data can outlive older versions of validation logic.

```typescript
function targetSubtitleOwner(counts: {
  human: number
  ai: number
}): AutomationOutputOwner {
  // Target subtitle automations are guarded to exactly one language before coverage is fetched.
  return sourceSubtitleOwner(counts)
}
```

### Render readable labels with an ID fallback

The Agents page builds a map from the already-loaded language options and passes it into the automation list:

```typescript
const languageNamesByCoreId = new Map(
  languageOptions.map((language) => [language.coreId, language.name]),
)
```

The list formatter uses the readable label when available and falls back to the raw ID for unknown values:

```typescript
export function formatLanguageSummary(
  languageIds: string[],
  languageNamesByCoreId: ReadonlyMap<string, string>,
): string {
  if (languageIds.length === 0) return "None"
  return languageIds
    .map((languageId) => languageNamesByCoreId.get(languageId) ?? languageId)
    .join(", ")
}
```

## Why This Works

The safety issue was not that arrays are inherently wrong. The unsafe part was allowing an array contract without a per-language ownership model behind it. Constraining `target_subtitles_missing` to one language means the aggregate coverage read is once again scoped to exactly one language decision.

The UI fix is intentionally read-model only. Persisted automations can keep storing stable core IDs, while the list resolves those IDs through the page's language metadata at render time. Unknown IDs remain visible instead of crashing or disappearing.

## Tests And Verification

Keep these regression tests around:

- Manager enqueue route rejects malformed `targetLanguageIds` payloads before runner dispatch.
- Manager enqueue route rejects `target_subtitles_missing` payloads with zero or multiple target languages.
- CMS validation rejects malformed schedule objects, non-array `targetLanguageIds`, and multi-language target subtitle records.
- Runner coverage keeps a defensive target-subtitle one-language guard.
- Automation list presenter renders labels such as `Ελληνικά` when labels exist and falls back to the raw ID when they do not.
- User-like browser smoke creates a target subtitle automation from the modal and verifies the saved row shows the readable language label, not the raw core ID.

This fix was verified with focused red/green Vitest coverage, full CMS and Manager test suites, root `pnpm test`, lint/format checks, and a browser smoke screenshot at `output/playwright/workflows-work-agents-language-label-smoke-20260412.png`.

## Prevention

1. Validate `targetLanguageIds` at every boundary: UI/create draft, Manager service enqueue, CMS persistence, and runner backstop.
2. Do not relax the one-language target subtitle rule until eligibility returns ownership per target language.
3. Treat human-owned output as a hard stop for the specific language being considered.
4. Keep persisted IDs and operator-readable labels separate: store IDs, render labels through loaded language metadata, and keep an ID fallback.
5. Add mixed-state tests whenever automation contracts cross UI, Manager API, CMS storage, and background scheduler layers.

## Related Issues

- [Manager Agents automations plan](../../plans/2026-04-12-feat-manager-agents-automations-plan.md)
- [Manager Agents automations roadmap ticket](../../roadmap/media-generation/feat-084-manager-agents-automations.md)
- [Manager job read model source language metadata](manager-job-read-model-source-language-metadata-20260409.md)
- [Manager Mux subtitle override recovery](manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md)
- [Backfill worker pattern for Manager](../platform/backfill-worker-pattern-manager-20260407.md)
