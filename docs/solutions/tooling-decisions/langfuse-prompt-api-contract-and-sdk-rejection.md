---
title: "Langfuse prompt-management API contract, and why apps/mastra hand-rolled a client instead of adopting the SDK"
date: "2026-07-22"
category: "tooling-decisions"
module: "apps/mastra/src/services/langfuse-prompt-client.ts"
problem_type: "tooling_decision"
component: "tooling"
severity: "high"
resolution_type: "tooling_addition"
applies_when:
  - "Adding or changing the Langfuse prompt-management integration in apps/mastra"
  - "Deciding whether to adopt @langfuse/client v5.x or the legacy langfuse 3.x package"
  - "Provisioning Langfuse keys, base URLs, or environment separation across dev/staging/prod"
  - "Writing a smoke test that asserts label-scoped prompt selection"
  - "Evaluating any vendor SDK against the repo's single-service HTTP client invariants"
symptoms:
  - "Langfuse Cloud keys are region-bound, so a hardcoded base-URL default yields confusing 401s instead of a clear unconfigured state"
  - "No read-only prompt key scope exists (Langfuse discussions #1692), so any leaked dev key carries full project read AND write"
  - "A smoke test requesting label `production` passes even when Langfuse ignores the label param, because `production` is its own omitted-param default"
  - '"@langfuse/client" has a known abort-listener leak (langfuse-js #858) hostile to long-lived processes and test runners'
  - "The commonly-cited prompt-to-trace linkage benefit was researched as not natively supported in the Mastra/Langfuse integration — UNVERIFIED, no on-branch anchor; re-check before reuse"
related_components:
  - "apps/mastra/src/config/env.ts"
  - "apps/mastra/src/services/jesusfilm-rag-client.ts"
  - "apps/mastra/src/agents"
related:
  - "docs/solutions/conventions/single-service-http-client-result-union-convention.md"
  - "docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md"
  - "docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md"
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md"
  - "docs/roadmap/ai-chat/feat-279-seeker-prompt-studio-block.md"
tags:
  - "langfuse"
  - "prompt-management"
  - "http-basic-auth"
  - "sdk-rejection"
  - "credential-scoping"
  - "environment-separation"
  - "smoke-test-trap"
  - "mastra"
---

# The Langfuse prompt-management vendor contract: Basic auth from a key pair, no read-only scope, and why the SDK was rejected

**Evidence markers used throughout.** Every claim below carries one:

- **[CODE]** — verified in source on the branch named below, with a `file:line` citation.
- **[VENDOR 2026-07]** — Langfuse documentation / GitHub discussions as researched on 2026-07-20. Vendor surfaces drift; re-verify before relying on it.
- **[OPERATIONAL]** — guidance not yet executed. No Langfuse account, project, key pair, or `LANGFUSE_*` deploy variable exists anywhere in this repo or its deploy configuration.

## Context

`apps/mastra` gained a two-layer helper for retrieving **Langfuse-managed system prompts** — text authored and versioned in the Langfuse UI, fetched at runtime, with a compiled-in fallback whenever retrieval fails. Layer 1 (`fetchLangfusePrompt`) is a single-attempt no-throw HTTP client over Langfuse's v2 Prompts API. Layer 2 (`getManagedPrompt`) stacks a TTL cache, failure cooldown, serve-stale, single-flight, and fallback-with-provenance on top. **[CODE]** `apps/mastra/CLAUDE.md:708-733`.

Two boundaries define what this is _not_:

- **Retrieval-only.** The helper never creates, updates, or moves prompts or labels. Authoring and versioning stay in the Langfuse UI. **[CODE]** `apps/mastra/CLAUDE.md:735-736`.
- **Unwired.** Nothing in the repo consumes it. It is a standalone module proven by tests (including a seeker-scenario block simulating the chat agent resolving its system prompt). Seeker wiring, prompt-composition split, SWR refresh, version pinning, sustained-fallback alerting, and label governance are all deferred to `docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`. **[CODE]** `apps/mastra/CLAUDE.md:744-749`.

  > **[SUPERSEDED 2026-07-29]** The seeker wiring has landed (feat-272 item 1, [PR #1788](https://github.com/JesusFilm/forge/pull/1788)): `seeker-agent.ts` backs its `instructions` with `getManagedPrompt` (prompt `seeker-system`) via `createSeekerInstructionsResolver`, full inline text preserved as the compiled-in fallback. The prompt-composition split was overruled by the owner's whole-prompt decision (feat-272 item 2) — the ENTIRE prompt, SAFETY line included, is Langfuse-managed. SWR, version pinning, and sustained-fallback alerting remain deferred in feat-272.

**Read this first: the authoritative files are not on `main`.** Everything cited here lives on the **unmerged** branch `feat/langfuse-prompt-helper` (PR **#1621**, state OPEN, `mergedAt: null` as of 2026-07-22). `git grep` against `main` finds none of it. To read the sources:

```bash
git fetch origin feat/langfuse-prompt-helper
git show origin/feat/langfuse-prompt-helper:apps/mastra/src/services/langfuse-prompt-client.ts
git show origin/feat/langfuse-prompt-helper:apps/mastra/src/config/env.ts
git show origin/feat/langfuse-prompt-helper:apps/mastra/src/services/langfuse-prompt-client.smoke.test.ts
git show origin/feat/langfuse-prompt-helper:apps/mastra/CLAUDE.md
git show origin/feat/langfuse-prompt-helper:docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md
```

Line numbers cited below are from those blob revisions. If PR #1621 merges, they may shift; the surrounding comment text is the durable anchor. The same caveat covers the roadmap ticket `docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md` and the plan `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md` cited throughout — both live only on that branch too.

A separate, competing path exists — managing the Seeker prompt as a **first-party Mastra Editor prompt block** (feat-279). That comparison and its own dependency trap are documented in `docs/solutions/integration-issues/mastra-editor-peer-range-false-negative-20260722.md`; this doc does not repeat it and is concerned only with the Langfuse vendor contract.

## Guidance

### A. The vendor API surface — each fact is load-bearing on code

**Endpoint. [VENDOR 2026-07] + [CODE]** `GET {baseUrl}/api/public/v2/prompts/{promptName}`, with an optional `?label=` query parameter. Transcribed from langfuse.com's API reference, captured 2026-07-20 — no SDK involved. `langfuse-prompt-client.ts:24-29` (path and provenance); the `?label=` parameter is set at `:314`, request built at `:306-317`.

**Auth is HTTP Basic over a key PAIR, not a Bearer token. [VENDOR 2026-07] + [CODE]** The documented scheme is `authorization: Basic base64(publicKey:secretKey)`. Every sibling client in `apps/mastra/src/services/` uses Bearer, so this is a deliberate, comment-documented divergence: `langfuse-prompt-client.ts:17-22` and again at the header construction `:325-328`, with the env-schema half flagged at `apps/mastra/src/config/env.ts:352-355`.

The pair-ness is not cosmetic — it propagates into the type system. Because either half can be absent independently, the unconfigured short-circuit is **three-way**, not one flat `config_missing`:

- `detail: "base_url_missing" | "public_key_missing" | "secret_key_missing"` **[CODE]** `langfuse-prompt-client.ts:75-82`, checked pre-fetch at `:271-297`.

Keep that three-way shape if you refactor. Collapsing it to a single `config_missing` destroys the only signal that tells an operator _which_ Railway variable they forgot, and it is emitted in the bounded failure log line rather than reconstructed by hand.

**The base URL deliberately has no default. [VENDOR 2026-07] + [CODE]** Langfuse Cloud keys are **region-bound** — the EU and US clouds are separate hosts holding separate projects, and a key issued in one region does not authenticate against the other. A hardcoded region default would therefore turn "operator has not configured Langfuse" into "operator gets 401s from the wrong region", which reads as a credential bug and costs real debugging time. So `LANGFUSE_BASE_URL` is `.optional()` with no default, and unset simply means unconfigured — the helper serves the caller's fallback. **[CODE]** `env.ts:348-351`, with the same posture restated in the operator table at `apps/mastra/CLAUDE.md:212`. Self-hosting is also supported, which is the second reason no single host is canonical. **[CODE]** `env.ts:784-787`.

**Prompt names may contain `/`. [VENDOR 2026-07] + [CODE]** Langfuse supports folder-scoped prompt names. The name is therefore `encodeURIComponent`-ed into the path segment — a raw `/` would change the route rather than name the prompt. `langfuse-prompt-client.ts:46-48`, `:299-311`. Note the secondary consequence handled in code: `encodeURIComponent` **throws** `URIError` on malformed UTF-16 (a lone surrogate), so the whole URL build sits inside its own `try` and returns a non-retryable `rejected` — an unencodable name is a permanent caller error and must not be misclassified as a network fault. `langfuse-prompt-client.ts:299-317`.

**Prompts carry a `type` discriminator, and only `text` is usable here. [VENDOR 2026-07] + [CODE]** A `type: "chat"` prompt carries an **array** body, not a string. Because the fetched text is destined to become agent instructions verbatim, anything that is not a usable text prompt must degrade to the fallback, never be served:

- `type === "chat"` or an array body → `parse_error` with `detail: "chat_type_unsupported"`
- `type !== "text"` or a non-string body → plain `parse_error`
- a whitespace-only or empty body → `parse_error` with `detail: "empty_prompt"`

**[CODE]** `langfuse-prompt-client.ts:38-44` (rationale), `:368-398` (implementation). The schema types `prompt` as `z.unknown()` rather than `z.string()` precisely so a chat prompt is _distinguishable_ from a malformed body instead of collapsing into one generic parse failure — `langfuse-prompt-client.ts:113-121`.

**A nonexistent prompt (or label) returns 404, classified non-retryable. [VENDOR 2026-07] + [CODE]** 404 rides the generic 4xx branch → `reason: "rejected"`, `retryable: false`, with the status carried. `langfuse-prompt-client.ts:230-263`; asserted live against the real API by the smoke at `langfuse-prompt-client.smoke.test.ts:168-175`. The full status map: 401/403 → `auth_failed` (non-retryable), 429 → `rate_limited` (retryable), other 4xx → `rejected` (non-retryable), 5xx → `network_error` (retryable).

**The response schema is `.passthrough()` over the consumed fields only. [CODE]** Only `prompt`, `version`, `labels`, `type` are required; everything else the vendor sends (`id`, `tags`, `config`, `commitMessage`, timestamps) passes through unvalidated and unexposed. This is what makes additive vendor evolution non-breaking: a new field cannot fail the parse. `parse_error` stays reserved for genuinely malformed or missing-required-field bodies. `langfuse-prompt-client.ts:31-36`, `:110-128`. `version` is `z.number().finite()` — `.finite()` rejects a JSON-legal `1e999`, which plain `z.number()` accepts and `JSON.stringify` then coerces to `null` downstream. `langfuse-prompt-client.ts:121-124`.

**Text is returned verbatim — no `{{variable}}` compilation. [CODE]** Langfuse prompts may contain mustache-style variables; this unit does not compile them. Whatever the API returns is what the caller gets. `langfuse-prompt-client.ts:42-44`, `:400-407`.

**Label defaulting is layer 2's job, never layer 1's. [CODE]** `fetchLangfusePrompt` passes `label` through verbatim and only when provided — an omitted label asks Langfuse for _its own_ default. `getManagedPrompt` resolves `call parameter > LANGFUSE_PROMPT_DEFAULT_LABEL > "production"` **before** cache keying and always passes the result explicitly, so an implicit `latest` never reaches the wire. `langfuse-prompt-client.ts:99-105`, `:312-314`, `:749-755`; env rung at `env.ts:381-385`.

### B. The credential model drives the operational posture

**There is no read-only prompt key scope. [VENDOR 2026-07]** Every Langfuse key pair carries full project access — reads of all project data _and_ trace writes. Source: Langfuse discussions **#1692**, recorded at `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md:149` with the risk restated at `:134`. That single fact drives three decisions:

**1. Environment separation must be separate Langfuse _projects_, one key pair each. [OPERATIONAL]** Not labels or native Environments within one project. A leaked dev key must not be able to read tuned production prompt text — and with coarse credentials, "can read the project" is the whole blast radius. Recorded as KTD8 at `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md:97` and in the operator docs at `apps/mastra/CLAUDE.md:738-742`. The helper itself only ever sees one project's keys.

This is **explicitly against Langfuse's own documented recommendation**, which favors native Environments inside a single project. **[VENDOR 2026-07]** — read from Langfuse's environments FAQ during 2026-07 research. Note the plan cites that FAQ as a source (`docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md:148`, itself on the unmerged branch) but does not record the direction of the vendor's recommendation, so re-read the FAQ before relying on this sentence. The divergence is intentional and worth stating plainly to whoever provisions the account, because they will read the vendor doc and reach the opposite conclusion: the vendor optimizes for prompt-sharing convenience across environments; this repo optimizes for blast radius given that the credential cannot be scoped. Do not "fix" the setup back toward one project without first checking whether a read-only prompt scope has shipped.

> **[SUPERSEDED 2026-07-28] Ruling 1 is reversed. Do not follow it.** Provisioning uses **ONE Langfuse project (`forge-mastra`)** with labels `production` / `development` distinguishing environments — the vendor-recommended layout this ruling argued against — in the same Langfuse organisation as `JesusFilm/core`'s Journeys project. The successor instruction is `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md`; the reasoning is recorded in the supersession note beside KTD8 in `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md`. In short: `apps/mastra` has one deployed environment, not three; the same people hold every key, so separating keys without separating people partitions one set; the org's own production Langfuse deployment is single-project-with-labels; and prompt versions/labels are project-scoped with no cross-project copy, so per-environment projects make promotion a manual re-authoring with forked version numbering. What survives from this ruling: the Railway key pair stays only in Railway service variables while the separate local-dev pair lives only in gitignored local `.env` files (never committed, never the Railway key copied onto a laptop), and the read-only-scope question is still worth re-checking — but as an input to the tracing decision (`docs/roadmap/ai-chat/feat-321-langfuse-tracing.md`), not as a gate on project topology.

**2. `production` should be a protected (admin-only) label within each project. [OPERATIONAL]** Since every key can write, the guard against an accidental or hostile prompt move to `production` is Langfuse's own protected-label feature, not the key. `apps/mastra/CLAUDE.md:741`, plan `:97`.

> **[SUPERSEDED 2026-07-29] Ruling 2 is not achievable here. Do not plan around it.** Protected labels are a Team/Cloud and Enterprise feature; this organisation is not on that tier. They also work by blocking the `viewer` and `member` roles while still permitting `admin` and `owner` — and every member of this organisation is an admin-or-owner developer — so the control would be inert even if purchased. **There is no technical guard against a prompt move to `production`.** What replaces it is not a process but a code boundary: feat-272's composition split keeps the SAFETY line and the `retrieveAnswer`-coupled citation wording code-owned, so a label move can only change tunable persona text, never the safety guardrail or citation discipline. Recorded in `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md`; vendor source: https://langfuse.com/changelog/2025-04-02-protected-prompt-labels **[AMENDED 2026-07-29]** That code boundary was itself overruled: the owner's whole-prompt decision (feat-272 item 2) makes the ENTIRE prompt Langfuse-managed, SAFETY line included — no code-owned portion bounds a label move. feat-272 items 2 and 6 record what bounds it now (roster snapshot, compiled-in fallback as rollback text, item 5's alerting).

**3. A fail-closed production egress guard is worth more here than it would be with a scoped key. [CODE]** Because the credential on the wire is full-project-access, where it can be sent matters proportionally more. In production, a _set_ `LANGFUSE_BASE_URL` must use https **and** have its hostname listed in `LANGFUSE_ALLOWED_HOSTS`, else boot throws. The allowlist has no default (no host is canonical, given region-bound cloud plus self-hosting), so base-URL-set-but-allowlist-unset throws too. `env.ts:780-798`, invoked at `:881-885`. This is the **only** Langfuse-driven boot throw: missing keys are deliberately _not_ in the production `missing` list, because an unconfigured helper is a valid state that degrades to the fallback at runtime. `env.ts:341-346`, `:881-885`.

The same reasoning drives `redirect: "error"` on the fetch: following a redirect would re-send full-project-access Basic credentials to an unvetted host, defeating the boot-time allowlist past the first hop. `langfuse-prompt-client.ts:331-334`.

Corollary for provisioning: **keys live only in Railway service variables** — never `.env` committed, never shared across environments. Plan `:134`. **[OPERATIONAL]**

> **[SUPERSEDED 2026-07-28 — the "only in Railway service variables" clause only.]** Under the one-project posture (see the reversal note on Ruling 1 above) there are **two key pairs** in the single `forge-mastra` project: the Railway pair lives only in Railway service variables, and a separate local-dev pair lives only in gitignored local `.env` files — so a leaked laptop key is revoked without rotating the production credential. Never copy the Railway key onto a laptop. The rest of the corollary stands unchanged: **never `.env` committed**, never shared across environments. Successor instruction: `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md`.

**Still undecided. [OPERATIONAL]** Hosting posture and ownership are explicitly deferred: Langfuse Cloud (and if so, EU or US — keys and base URLs are region-bound) vs self-hosted, and who provisions the per-environment projects, key pairs, and the seeded smoke prompt. This blocks the smoke from ever running and blocks the feat-272 integration; it does not block the helper. The helper is deliberately posture-agnostic — that is the point of `LANGFUSE_BASE_URL` having no default. `docs/plans/2026-07-20-001-feat-langfuse-prompt-helper-plan.md:140`.

> **[UPDATED 2026-07-28 — no longer undecided.]** Langfuse Cloud, in the **same organisation** as `JesusFilm/core`'s Journeys project, therefore the same region as that organisation (read it off the dashboard; EU and US are separate deployments). **One** project, `forge-mastra`, with labels `production` / `development` distinguishing environments — not per-environment projects (see the reversal note on Ruling 1). Two key pairs inside it, Railway and local dev. Provisioning and the safe env-var rollout order are tracked in `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md`; the helper's posture-agnosticism is unchanged and still the reason `LANGFUSE_BASE_URL` has no default.

### C. The SDK was considered and rejected — record, not dismissal

**SDK generation. [VENDOR 2026-07]** The current client is `@langfuse/client` **v5.9.x**. The legacy `langfuse` 3.x monolith is **documentation-orphaned — never adopt it**. If a future agent finds a Stack Overflow answer or blog post importing from `langfuse` directly, that is the orphaned line. Plan `:149`.

**Why rejected. [CODE for the invariants, VENDOR 2026-07 for the SDK behavior]** The SDK cannot carry this repo's house client invariants:

- production host allowlist on credentialed egress (`env.ts:780-798`)
- byte-capped reads on **both** the success and error paths — a streamed byte counter that aborts the socket past the cap, never trusting `Content-Length` (`langfuse-prompt-client.ts:148-215`; 256 KiB default, `env.ts:44-49`)
- `redirect: "error"` (`langfuse-prompt-client.ts:331-334`)
- no-throw discriminated result unions (`langfuse-prompt-client.ts:66-95`)
- leak control — prompt bodies, key material, and raw response bodies never reach a throw, a log, or the typed result; even a caught `JSON.parse` SyntaxError is swallowed unlogged because it can embed body fragments (`langfuse-prompt-client.ts:56-63`, `:160-168`)

Plus a known open-handle / abort-listener leak (**langfuse-js #858**) that is actively hostile to long-lived processes and test runners — relevant because a single Node process runs every Mastra agent and workflow. Plan `:90`, `:149`.

**What was adopted anyway — this is the reusable move.** The SDK's _semantics_ are good and were imported as design targets even though the dependency was refused: **60s TTL default** (`env.ts:50`, `DEFAULT_LANGFUSE_PROMPT_CACHE_TTL_MS = 60_000`), **fallback-with-provenance** (`source: "langfuse" | "fallback"` plus `stale`/`reason` on the return type, `langfuse-prompt-client.ts:461-474`), and **label-following**. One caveat on that middle item: provenance was adopted on the **fallback arm only** — a _stale_ serve carries `stale: true` but no `reason`, so the degraded-serve signal is thinner than "fallback-with-provenance" suggests. See `docs/solutions/design-patterns/serve-stale-cache-permanent-failure-exit-and-degraded-serve-provenance.md` Law 2. Rejecting a dependency does not mean rejecting the thinking behind it — read its docs for the defaults it converged on, then implement those defaults yourself. Plan `:90`.

**One pro-SDK argument that does not apply here. [VENDOR 2026-07]** The most commonly cited reason to take the Langfuse SDK is prompt↔trace linkage — every generation automatically attributed to the prompt version that produced it. Research during this work concluded **that linkage is not natively supported in the Mastra/Langfuse integration**, attributed to a Langfuse maintainer in discussion **#10538**.

> ⚠️ **This is the one claim in this document with no anchor.** Unlike every other vendor fact here, `#10538` appears nowhere on the PR branch and nowhere in the plan — it survives only as a research assertion. Treat it as a lead, not a finding: **verify it before letting it decide anything.** It is recorded because a wrong-but-checkable claim is more useful than a silently dropped one.

The reason to record it at all is that the argument otherwise re-enters a future revisit unexamined. If someone proposes adopting the SDK _for_ trace linkage, the first move is to confirm the current linkage story directly with Langfuse — not to assume either this note or the SDK's marketing.

The stated revisit trigger is narrow: **only if Langfuse tracing is adopted**, which is a separate decision with its own evaluation. Plan `:90`, and tracing/observability SDK adoption is explicitly out of scope at `:82`.

### D. A vendor-specific testing trap: never test with the vendor's own default

**The trap. [VENDOR 2026-07] + [CODE]** Langfuse applies `production` as its **own** default label when the `label` query parameter is omitted. So a smoke test that requests label `production` and receives a prompt body **cannot distinguish** two very different worlds:

1. the client sent `?label=production` and Langfuse honored it, or
2. the client never sent the parameter at all (or Langfuse ignored it) and simply applied its default.

Both produce a green test. The test proves nothing about label selection while appearing to be exactly the test that covers it — a false-confidence assertion, and the highest-value kind of test bug because it is invisible in a passing suite.

**The fix.** Seed **one** prompt with **two** versions under **two** labels — `production` and a **non-default** label (`smoke`) — each carrying a **distinct exact sentinel body**, then assert strict equality against the sentinel. Receiving the `smoke` sentinel is possible only if the parameter was sent _and_ honored end to end; receiving the `production` sentinel would mean label selection silently broke. **[CODE]** `langfuse-prompt-client.smoke.test.ts:36-41` (the rationale), `:56-73` (the constants), `:146-154` (the assertion and its comment).

Three supporting properties of that smoke, all worth copying:

- **`describe.skipIf`-gated on an env flag**, so it is skipped _and reported as skipped_ in every default run. Only the literal `"1"` enables it — any other non-empty value fails env parse rather than half-enabling. `env.ts:398-400`, `langfuse-prompt-client.smoke.test.ts:54`, `:79`.
- **Never self-seeds.** Retrieval is the helper's whole boundary; a self-seeding test would need write access and would be testing a surface the helper does not have. The seeding convention is a documented one-time manual step in the file header. `langfuse-prompt-client.smoke.test.ts:19-41`.
- **Fails LOUD, never skips, when credentials exist but the seeded prompt is missing.** The failure message names the prompt, the label, the reason/status/detail, and points back at the seeding convention in the same file. `langfuse-prompt-client.smoke.test.ts:43-46`, `:93-108`, `:130-144`.

A bonus the seeding convention buys for free: the smoke prompt name is `forge-mastra-smoke/text-prompt` — the `/` is deliberate, so resolving it live also proves the client's URL path-segment encoding against the real API. The negative-path name is slashed too. `langfuse-prompt-client.smoke.test.ts:22-25`, `:69-71`.

**Generalize it beyond Langfuse:** _when a vendor has a default value for the parameter you are testing, testing with that default value proves nothing._ Always test with a non-default, and make the expected result distinguishable from the default's result. This applies to any defaulted API parameter — label, version, locale, region, sort order, page size, environment. Before writing the assertion, ask: "if the server ignored this parameter entirely, would this test still pass?" If yes, the test is decorative.

## Why This Matters

- **A defaulted base URL turns "unconfigured" into "401".** Langfuse Cloud keys are region-bound. Ship a hardcoded `https://cloud.langfuse.com` default and every environment that has not been provisioned starts authenticating against the wrong region — producing an auth failure, which reads as a credential problem, which sends an operator to rotate keys that were never wrong. No default makes the unconfigured state say `config_missing` with a `base_url_missing` detail: honest, self-describing, and one grep from the fix.
- **A flat `config_missing` costs an operator a bisect.** With a key pair, three things can independently be absent. One undifferentiated reason means checking three Railway variables by hand across however many services; the three-way detail names the missing one in the log line.
- **A leaked dev key reads production prompt text.** No read-only scope exists, so the only containment is project separation. Get this wrong and a low-trust environment's credential — the one most likely to end up in a local shell, a CI log, or a shared `.env` — reads (and can overwrite) the tuned prompts that drive production behavior. The vendor's recommended single-project-with-Environments layout gives you convenience and this exposure together.

  > **[SUPERSEDED 2026-07-28 — "the only containment is project separation" no longer holds as guidance.]** This project deliberately accepts that exposure: one `forge-mastra` project, labels for environments (see the reversal note on Ruling 1 above). The containment that was actually bought here is nil, because the same people hold every key and can read the project through the dashboard regardless — project separation only ever bounded a _leaked_ credential. Live mitigations: two key pairs inside the one project so a leaked local key is revoked without rotating production's, and keys confined to Railway service variables and local `.env` files. A protected `production` label is NOT among the mitigations — **[UPDATED 2026-07-29]** it is a Team/Enterprise feature this organisation is not on, and it works by blocking `viewer`/`member` while permitting `admin`/`owner`, so it would be inert here regardless. There is no technical control over who moves that label; see `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md`. The "and can overwrite" clause is the part to keep front of mind — write access is the sharper threat, and it is unaffected by topology.

- **A chat-type prompt served as instructions is a silent behavioral regression.** Someone changes a prompt's type in the UI, or moves a chat prompt onto the wrong label, and the agent's system instructions become `[object Object]` or a JSON array serialization. Degrading to the fallback with `chat_type_unsupported` keeps the agent working _and_ leaves an enum-shaped log line naming exactly what happened. Same for `empty_prompt`: an accidentally blanked prompt should not silently strip an agent's instructions.
- **A smoke that tests the vendor's default proves nothing while looking definitive.** It is green today and green on the day the client stops sending `?label=` entirely. Every production prompt would then resolve to whatever sits on `production` — which is _usually_ right, and therefore fails in exactly the confusing way: only the environments tracking a non-default label break, long after the change that broke them.
- **Following a redirect leaks a full-project-access credential.** The allowlist is a boot-time control on one hop; without `redirect: "error"` an upstream 302 carries Basic credentials past it.

## When to Apply

Reach for this doc when you are:

- **Wiring or debugging the Langfuse integration** — chasing a `config_missing`, `auth_failed`, `rejected`, or `parse_error` and needing to know which vendor behavior produced it. Start from the failure reason/detail union at `langfuse-prompt-client.ts:66-83`.
- **Picking up feat-272** (`docs/roadmap/ai-chat/feat-272-seeker-langfuse-managed-prompt-integration.md`) — seeker wiring, prompt-composition split, SWR refresh, version pinning, sustained-fallback alerting, label governance. **[UPDATED 2026-07-29]** The wiring shipped and the composition split was overruled (whole-prompt decision, feat-272 item 2); the open scope is SWR, version pinning, and alerting + span stamping.
- **Provisioning the Langfuse account** — creating the project and key pairs, populating Railway variables, seeding the smoke prompt. Sections B and D are the checklist. **[UPDATED 2026-07-29]** This has now been executed: one `forge-mastra` project in the US region, two key pairs, smoke seeded and green. Protected labels are NOT part of the checklist — they are unavailable on this tier and role-based so inert here anyway. `docs/roadmap/ai-chat/feat-296-langfuse-configuration.md` is the authoritative record.
- **Revisiting the SDK decision** — section C is the record to argue against, including the two arguments (trace linkage; the legacy `langfuse` package) that must not be reused uncritically.
- **Writing a smoke or integration test against _any_ vendor with defaulted parameters** — section D generalizes past Langfuse and is the most transferable part of this doc.
- **Adding another single-service HTTP client in `apps/mastra`** — this client is a faithful copy of `jesusfilm-rag-client.ts` under `docs/solutions/conventions/single-service-http-client-result-union-convention.md`, with per-site provenance comments; it is a good second exemplar, especially for the auth-scheme divergence and the content-validation layer.

## Examples

All excerpts from `origin/feat/langfuse-prompt-helper` (PR #1621, unmerged).

**Basic auth from the key pair, with the sibling divergence documented at both the header and the call site** — `apps/mastra/src/services/langfuse-prompt-client.ts:17-22`:

```
 * BASIC AUTH (divergence from the Bearer siblings): Langfuse's documented
 * scheme is `authorization: Basic base64(publicKey:secretKey)` — a key PAIR,
 * not a single bearer token. Both halves are load-bearing secrets (Langfuse
 * keys carry full project access; no read-only prompt scope exists), so the
 * `config_missing` short-circuit is three-way: base URL, public key, and
 * secret key are each individually detectable before any fetch.
```

and `langfuse-prompt-client.ts:321-336`:

```ts
response = await fetchImpl(url, {
  method: "GET",
  headers: {
    // Basic auth from the key PAIR — Langfuse's documented scheme; see the
    // header comment for the divergence from the Bearer siblings.
    authorization: `Basic ${Buffer.from(
      `${config.publicKey}:${config.secretKey}`,
    ).toString("base64")}`,
    "user-agent": config.userAgent,
  },
  // The prompts API has no legitimate redirect; following one would re-send
  // the Basic credentials (full-project-access keys) to an unvetted host,
  // defeating the boot-time allowlist beyond the first hop.
  redirect: "error",
  signal: AbortSignal.timeout(config.timeoutMs),
})
```

**The three-way unconfigured short-circuit, pre-fetch** — `langfuse-prompt-client.ts:271-297`:

```ts
// Configured means the base URL AND both auth halves are present; degrade
// (never boot-throw) on any third absent, distinguishing which for the
// observable misconfiguration log layer 2 emits. Checked BEFORE any fetch.
if (!config.baseUrl) {
  return {
    ok: false,
    reason: "config_missing",
    retryable: false,
    detail: "base_url_missing",
  }
}
if (!config.publicKey) {
  return {
    /* ... detail: "public_key_missing" */
  }
}
if (!config.secretKey) {
  return {
    /* ... detail: "secret_key_missing" */
  }
}
```

**No default base URL, because cloud keys are region-bound** — `apps/mastra/src/config/env.ts:341-355`:

```ts
  // Langfuse prompt retrieval (2026-07-20 prompt-helper plan, U1). Fully
  // optional — unset degrades the helper to the caller-supplied fallback
  // prompt at runtime, never a boot failure. The base URL is gated by
  // `LANGFUSE_ALLOWED_HOSTS` in production (the one Langfuse-driven boot
  // throw — a security control), but no LANGFUSE_* var is ever pushed into the
  // production `missing` list (KTD5).
  LANGFUSE_ALLOWED_HOSTS: z.string().min(1).optional(),
  // No default base URL: Langfuse cloud keys are region-bound, so a hardcoded
  // region default yields confusing 401s. Unset means unconfigured — the same
  // posture as JESUSFILM_RAG_BASE_URL.
  LANGFUSE_BASE_URL: z.string().url().optional(),
  // Unlike the Bearer-token siblings in this file, this key pair feeds HTTP
  // Basic auth (`base64(public:secret)`) — Langfuse's documented auth scheme.
  LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
  LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
```

**The fail-closed production egress guard — the only Langfuse boot throw** — `env.ts:780-798`:

```ts
function assertLangfuseBaseUrlAllowedForProduction() {
  // Conditional on the base URL being set: unconfigured Langfuse is valid by
  // design (the prompt helper degrades to the caller-supplied fallback). When
  // the URL IS set, fail-closed — https AND a non-empty allowlist containing
  // the hostname, else throw. The allowlist has no default (Langfuse cloud is
  // region-bound and self-hosting is supported, so no single host is
  // canonical), so a base-URL-set-but-allowlist-unset production config throws
  // here. Mirrors `assertJesusfilmRagBaseUrlAllowedForProduction`.
  if (!env.LANGFUSE_BASE_URL) return
  const baseUrl = new URL(env.LANGFUSE_BASE_URL)
  const allowedHosts = env.LANGFUSE_ALLOWED_HOSTS
    ? csvSet(env.LANGFUSE_ALLOWED_HOSTS)
    : new Set<string>()
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error(
      "LANGFUSE_BASE_URL must use https and a host listed in LANGFUSE_ALLOWED_HOSTS for Mastra production",
    )
  }
}
```

**The `type` discriminator rejection — unusable bodies degrade, never serve** — `langfuse-prompt-client.ts:368-398`:

```ts
// Content validation (plan KTD6): the fetched text becomes agent
// instructions verbatim, so anything that is not a usable text prompt is a
// failure with a distinguishing detail — never ok. No body text is carried
// into any of these failures.
const { prompt, type } = parsed.data
if (type === "chat" || Array.isArray(prompt)) {
  return {
    ok: false,
    reason: "parse_error",
    retryable: false,
    status: response.status,
    detail: "chat_type_unsupported",
  }
}
if (type !== "text" || typeof prompt !== "string") {
  return {
    ok: false,
    reason: "parse_error",
    retryable: false,
    status: response.status,
  }
}
if (prompt.trim().length === 0) {
  return {
    ok: false,
    reason: "parse_error",
    retryable: false,
    status: response.status,
    detail: "empty_prompt",
  }
}
```

with the schema that makes the chat case _distinguishable_ rather than generically malformed — `langfuse-prompt-client.ts:113-128`:

```ts
const PromptResponseSchema = z
  .object({
    // `z.unknown()`, not `z.string()`: a chat-type prompt carries an ARRAY
    // here, and the client must distinguish "chat prompt" (detail
    // `chat_type_unsupported`) from "malformed body" — a string-typed field
    // would collapse both into one generic parse_error. The type-specific
    // shape is enforced in the content-validation step below.
    prompt: z.unknown(),
    version: z.number().finite(),
    labels: z.array(z.string()),
    type: z.string(),
  })
  .passthrough()
```

**The smoke seeding convention — why two labels with different bodies** — `apps/mastra/src/services/langfuse-prompt-client.smoke.test.ts:19-46`:

```
 * ONE-TIME SEEDING CONVENTION (manual, via the Langfuse UI — the test never
 * self-seeds; retrieval is this helper's whole boundary, plan R4):
 *
 *   - Project:  `forge-mastra` — the one Langfuse project the LANGFUSE_* env
 *               vars point at (environments are distinguished by prompt
 *               LABELS, not by separate projects)
 *   - Prompt:   name `forge-mastra-smoke/text-prompt`
 *               (the `/` in the name is deliberate — resolving it live
 *               doubles as proof of the client's URL path-segment encoding)
 *   - Type:     text (NOT chat)
 *   - Versions: ONE prompt, TWO versions, TWO labels (idiomatic Langfuse).
 *               The bodies are EXACT — the tests assert strict equality, not
 *               "any non-empty text":
 *
 *       Version 1 — label `production`, body EXACTLY:
 *         "forge-mastra smoke sentinel: managed prompt retrieval works."
 *       Version 2 — label `smoke`, body EXACTLY:
 *         "forge-mastra smoke sentinel: non-default label selection works."
 *
 *   WHY two labels with DIFFERENT bodies: `production` is ALSO Langfuse's
 *   documented default when the `label` param is omitted, so a
 *   production-labeled prompt alone cannot prove the client actually sends
 *   (and Langfuse honors) `?label=`. Fetching label `smoke` and receiving
 *   its distinct sentinel body is possible ONLY if label selection worked
 *   end to end.
 *
 * FAIL-LOUD CONTRACT: when credentials are present (the suite is enabled)
 * but a seeded prompt version is missing, this suite FAILS — it never skips.
```

and the assertion that cashes it in — `langfuse-prompt-client.smoke.test.ts:146-154`:

```ts
// The `smoke` label carries a DIFFERENT exact body than `production`
// (Langfuse's omitted-label default), so this equality can only hold
// if the client sent `?label=` AND Langfuse honored it — receiving
// the production sentinel here would mean label selection silently
// broke while staying green on non-empty-text assertions.
expect(result.text).toBe(SMOKE_LABEL_SENTINEL_TEXT)
```

**Running the smoke** (requires the one-time manual seeding above; no credentials exist yet) — `langfuse-prompt-client.smoke.test.ts:48-51`:

```bash
LANGFUSE_PROMPT_SMOKE_TEST=1 LANGFUSE_BASE_URL=... \
LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
pnpm --filter @forge/mastra test -- langfuse-prompt-client.smoke
```

## Related

- `docs/solutions/design-patterns/async-single-flight-slot-release-hazards.md` — the concurrency
  axis of the same client: how `getManagedPrompt`'s single-flight slot must be released. Compounded
  from the same unmerged PR; the two are siblings, not overlaps.
- `docs/solutions/integration-issues/mastra-editor-peer-range-false-negative-20260722.md` — the
  **competing first-party path** (feat-279, Mastra Editor prompt blocks), blocked on a
  `@mastra/core` ≥ 1.43 bump. The vendor-vs-first-party comparison lives there and in the roadmap;
  this doc deliberately does not re-litigate it.
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md` — the house
  client convention this client instantiates. Note it now needs updating on two counts: its
  incidental bearer-token language (at its `:108` and `:174`) assumes a single bearer token, whereas
  Langfuse uses HTTP Basic from a key pair — it has no auth-scheme section at all, and
  its "duplicated, not extracted" note names _"when a third consumer needs the helper"_ as its own
  flip condition — Langfuse is that third consumer of `endpoint`/`safeReason`/`readUpstreamReason`.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the
  smoke-test trap in section D is a new instance for that doc's table, and a new _kind_: a
  real-credential test whose input coincides with the upstream's own default, rather than a mocked
  shape diverging from a real contract.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
  — why all eleven `LANGFUSE_*` vars are optional with runtime fallbacks.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` and
  `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md` — the TIME
  and SIZE bounds this client carries.
