---
title: "OpenAI strict:true + anyOf drops required fields — lenient per-section parse as a safety net"
date: "2026-04-22"
category: best-practices
module: apps/web
problem_type: best_practice
component: web
severity: medium
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - apps/web/src/lib/experience-generator.ts
related_docs:
  - "docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md"
  - "docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md"
tags:
  - openai
  - openrouter
  - json-schema
  - strict-mode
  - anyof
  - structured-output
  - zod
  - gpt-4o-mini
  - gpt-4o
  - demo-search
---

# OpenAI strict:true + anyOf drops required fields — lenient per-section parse as a safety net

## Problem

The `/demo-search` experience generator asks `openai/gpt-4o-mini` (via OpenRouter) to return a JSON object with a `sections: [spotlight | theme-carousel | bible-verse]` array, using `response_format: { type: "json_schema", strict: true, schema: { ... anyOf ... } }` with every branch listing all its fields as `required`. The model reliably returned responses like:

```json
{"title":"…","intro":"…","sections":[
  {spotlight OK},
  {theme-carousel OK},
  {"type":"bible-verse","reference":"John 20:30-31","text":"Jesus"}  ← no `reflection`
]}
```

The text was not truncated — `finish_reason: stop`, `completion_tokens: 240`. The model _chose_ to close the object early, and OpenAI's strict constrained decoder accepted it. Zod (with a strict discriminated union) rejected the whole response, users saw "Couldn't parse the generated response" on most queries.

## Symptoms

- `SCHEMA_MISMATCH` error surfaced to user ("Couldn't parse the generated response. Try again — the model usually recovers on a second pass.") on ~every call with certain queries (apologetics, resurrection).
- Server log: `[experience-generator] schema validation failed` with zod issue `expected string, received undefined` on `sections[N].reflection`.
- OpenRouter reported `finish_reason: stop`, not `length` — not truncation.

## What Didn't Work

- **Raising `max_tokens` from 800 → 1500.** Didn't help. The issue wasn't truncation; the model just emitted fewer tokens than the required-field list demanded.
- **Re-running (the "model usually recovers on a second pass" error copy).** Failed ~every time, not intermittently — the model's shortcut was deterministic for this prompt shape.
- **Tightening the prompt with "every field is REQUIRED."** Marginal improvement, not reliable.

## Solution

Two complementary changes. Either alone helps; together they're robust.

### 1. Swap to a stricter model (primary fix)

```ts
// apps/web/src/lib/experience-generator.ts
const MODEL = "openai/gpt-4o" // was "openai/gpt-4o-mini"
const TIMEOUT_MS = 20_000 // was 15_000 (gpt-4o's latency tail is longer)
```

gpt-4o enforces `strict: true` + `anyOf` substantially more reliably than `gpt-4o-mini`. Per-run cost rises from ~$0.001 to ~$0.01 — acceptable for a demo that runs a few times per stakeholder view.

### 2. Lenient per-section zod parse (defense-in-depth)

Even with gpt-4o, the schema union → shortcut failure mode can re-emerge under prompt drift or model regressions. Parse the outer envelope loosely and validate each section individually, dropping the malformed ones.

```ts
// Before: one strict parse, reject everything on any failure
const zResult = ExperienceSchema.safeParse(parsed)
if (!zResult.success) throw new ExperienceGeneratorError("SCHEMA_MISMATCH", ...)

// After: outer envelope loose, sections validated per-item, drop-malformed
const OuterEnvelopeSchema = z.object({
  title: z.string().min(1),
  intro: z.string().min(1),
  sections: z.array(z.unknown()).min(1).max(5),
})

const outerResult = OuterEnvelopeSchema.safeParse(parsed)
if (!outerResult.success) throw new ExperienceGeneratorError("SCHEMA_MISMATCH", ...)

const validSections: ExperienceSectionNode[] = []
for (const raw of outerResult.data.sections) {
  const sectionResult = ExperienceSection.safeParse(raw)
  if (sectionResult.success) {
    validSections.push(sectionResult.data)
  } else {
    console.warn("dropping malformed section", sectionResult.error.issues)
  }
}

if (validSections.length === 0) {
  throw new ExperienceGeneratorError("SCHEMA_MISMATCH", "no well-formed sections")
}
```

## Why This Works

- **Model swap attacks the root cause.** gpt-4o's constrained decoder respects `anyOf` branch requirements where mini's shortcuts. The behavior difference is big enough to justify the 10× cost delta for low-volume demo/stakeholder surfaces.
- **Lenient per-section parse is a safety net, not the primary fix.** If the model drops a field on one section, the other sections survive and the user gets a usable (if slightly degraded) experience. Previously a single bad section killed the whole response.
- **The two together** cover the common failure mode (strict-weak model gets upgraded) AND the rare failure mode (strict-strong model still slips).

## Prevention

**Rule 1 — for strict-mode `anyOf` schemas, don't trust the model's union enforcement.** OpenAI docs explicitly flag that `anyOf` branch required-field enforcement is weaker than top-level required-field enforcement. If you can flatten the schema (single object with a `type` discriminator + all branch-specific fields as optional-but-enumerated), do that instead of `anyOf`.

**Rule 2 — always check `finish_reason` before parsing content.** If it's `"length"`, the output is truncated and any lenient parser can produce a silent partial success that should really be a failure. The code should surface an `UPSTREAM_ERROR` on `finish_reason === "length"` regardless of how many sections parsed:

```ts
const choice = payload.choices?.[0]
if (choice?.finish_reason === "length") {
  throw new ExperienceGeneratorError(
    "UPSTREAM_ERROR",
    "Model response was truncated",
  )
}
```

**Rule 3 — emit a structured log when sections are dropped.** `console.warn` alone is invisible in prod. Include a stable key (e.g. `event: "experience_section_dropped"`) so log aggregators can alert on rising drop rates that would otherwise just look like "fewer sections than designed".

**Rule 4 — keep the request JSON schema (`minItems`/`maxItems`) and the Zod schema in lockstep, or document the asymmetry.** A permissive zod (`.min(1).max(5)`) paired with a strict wire schema (`minItems: 2, maxItems: 3`) is OK as defensive coding, but mark it explicitly — otherwise a future reader relaxes one and forgets the other.

**Rule 5 — test the mixed-valid-and-invalid case.** The motivation for lenient parsing is to tolerate a single bad section among good ones. A regression that flips "drop malformed, keep valid" to "throw on any malformed" is easy to introduce and invisible without a test:

```ts
it("keeps valid sections when one is malformed", async () => {
  mockOpenRouter({
    title: "X", intro: "Y",
    sections: [
      { type: "spotlight", videoSlug: "a", why: "…" },
      { type: "bible-verse", reference: "X", text: "Y" },  // missing `reflection`
      { type: "theme-carousel", theme: "…", videoSlugs: ["a","b","c"], caption: "…" },
    ],
  })
  const result = await generateExperience("query", [{slug: "a", ...}, {slug: "b", ...}, {slug: "c", ...}])
  expect(result.experience.sections).toHaveLength(2)  // bible-verse dropped
})
```

**Cross-reference:** the broader end-to-end pattern for LLM structured output in this repo (typed errors, retry policy, slug allowlist, rate limiting) lives in `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`. This doc adds the two specific gotchas (`anyOf` weakness, `finish_reason: length`) that pattern doc didn't cover.
