---
title: "feat: Daily devotional generator (Mastra workflows)"
type: feat
status: active
created: 2026-06-17
origin: docs/brainstorms/2026-06-17-daily-devotional-generator-requirements.md
target_repo: forge (apps/mastra + a watch-site page dependency)
---

# feat: Daily devotional generator (Mastra workflows)

## Problem & Scope

Produce one engaging, timely, scripture-centered **devotional per day**, published
to a "Today's Devotional" page on the Jesus Film Watch experiment site. Each day:
pick a **hook** (timely world news prominent; holidays/Christian calendar; else an
intriguing question) → choose a **scripture passage** → find a relevant **Jesus
Film library clip** → write an **original reflection** grounded in trusted partner
teaching → add **reflection questions** → run an automated **doctrinal +
tone/sensitivity safety gate** → **auto-publish** (with easy human pull/edit). The
day-to-day **structure varies** so it never feels formulaic
(see origin: docs/brainstorms/2026-06-17-daily-devotional-generator-requirements.md).

**In scope (this plan — Mastra side):** the generation pipeline as a set of
services composed by one `daily-devotional` workflow, the LLM-judge safety gate,
the artifact report, the service-bearer route, and a publish client that submits
the finished devotional to the watch site.

**Out of scope (this plan):** the watch-site "Today's Devotional" page + its
ingest/store endpoint (web-team dependency — mirrors the discovery → site-ingest
contract); multilingual output; news-day human approval; an archive/past-days
experience; email/social distribution. (All carried from origin "Deferred for
later".)

---

## Assumptions (resolved autonomously — please review)

These were open questions in the origin doc; I picked sensible defaults to keep
moving while Lyuba is away. Each is cheap to change.

- **A1 — News source = Firecrawl web search.** Firecrawl is already configured in
  `apps/mastra`. The hook-picker queries it for recent notable events, and an LLM
  selects + frames one. Swappable for a dedicated news API later. (Alternative:
  a curated RSS/news feed.)
- **A2 — Video matching = admin semantic search over the catalog.** Reuse the
  Mastra→admin HTTP search pattern (`admin-search-eval-client.ts` +
  `ADMIN_SEARCH_EVAL_SEARCH_URL`). The exact production search endpoint/contract
  for "find a Jesus Film clip for this passage/topic" must be confirmed at exec
  time; treat the client as an injectable seam.
- **A3 — Doctrinal + sensitivity gate = in-workflow LLM judge.** feat-067
  Doctrinal Validation Engine is not-started (P2, Dec 2026). This plan ships a
  self-contained LLM-as-judge gate (reusing the `offline-search-eval/judge.ts`
  OpenRouter pattern). Future: consolidate onto feat-067 when it exists.
- **A4 — Partner grounding = read public partner teaching via Firecrawl, write
  original.** A configured list of partner domains; the writer searches them for
  reliable teaching on the day's theme and writes original text, optionally
  linking one piece as "further reading". Never republishes.
- **A5 — Bible text.** The devotional emits a scripture **reference** plus a short
  quoted passage; the canonical translation/source is confirmed at exec time
  (Bible API vs. the watch site rendering it). Flagged so we don't ship an
  unverified paraphrase as scripture.
- **A6 — Scheduling is external.** No in-app cron exists in Mastra. A daily
  Railway cron (or equivalent) calls `POST /forge-daily-devotional` with the
  service bearer. The workflow itself is on-demand/idempotent per day.
- **A7 — Publish target = a watch-site ingest endpoint**, mirroring the discovery
  → site-ingest contract (opt-in via env URL+token; best-effort; never fails the
  run). The page + endpoint are a web-team dependency.
- **A8 — "Always a clip" fallback.** If video search returns nothing genuinely
  relevant (below a score threshold), fall back to a configured default clip
  rather than forcing a weak match; record which happened in the report.

---

## Requirements Traceability

| Requirement (origin)                                                            | Where addressed                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Daily hook: news prominent, holiday/calendar, intriguing-question fallback      | U2                                                            |
| Scripture passage chosen to cohere with the hook                                | U3                                                            |
| Relevant Jesus Film library clip, always present (with fallback)                | U4 (+ A8)                                                     |
| Original reflection grounded in partner teaching, optional further-reading link | U5 (+ A4)                                                     |
| Reflection questions                                                            | U5                                                            |
| Flexible per-day structure (varying arrangement)                                | U5                                                            |
| Auto-publish with automated doctrinal + tone/sensitivity safety net             | U6 (gate) + U8 (publish only on pass)                         |
| Published to Today's Devotional page on the watch site                          | U7 (+ A7)                                                     |
| Human can pull/edit any day                                                     | Web-side dependency; bot writes drafts the site can unpublish |
| One per day, scheduled                                                          | A6 (external cron) + U8 route                                 |

---

## High-Level Technical Design

```
(daily external cron) ─► POST /forge-daily-devotional
        │
        ▼
  pick-hook ──► select-scripture ──► match-video ──► write-devotional ──► safety-gate
   (news/        (passage that        (admin search    (original text,       (LLM judge:
   holiday/       fits the hook)       → clip; A8        grounded in           doctrine +
   question)                          fallback)         partners; flexible    tone/sensitivity)
                                                        block order)              │
                                                                    pass ─────────┤── block → do NOT publish,
                                                                                  │           record blocked report
                                                                                  ▼
                                                              write artifact + submit to watch site
```

_Directional guidance for review, not implementation specification. The
implementing agent should treat it as context, not code to reproduce._

The day's devotional is a structured object: `{ date, hook, scripture, video,
reflection, questions[], furtherReading?, blockOrder[] }`. `blockOrder` is the
per-day arrangement (a permutation of the present ingredients) so rendering varies
day to day (see U5).

---

## Output Structure

```
apps/mastra/src/
├── config/env.ts                              (modify: DEVOTIONAL_* vars + getters)
├── services/devotional/
│   ├── types.ts                               (Devotional, Hook, DevotionalReport, SafetyVerdict)
│   ├── hook-picker.ts (+ .test.ts)            (U2)
│   ├── scripture-selector.ts (+ .test.ts)     (U3)
│   ├── video-matcher.ts (+ .test.ts)          (U4)
│   ├── devotional-writer.ts (+ .test.ts)      (U5)
│   ├── safety-gate.ts (+ .test.ts)            (U6)
│   ├── site-publish-client.ts (+ .test.ts)    (U7)
│   └── artifacts.ts (+ .test.ts)              (U8 report store)
└── mastra/
    ├── index.ts                               (modify: register workflow + route)
    └── workflows/
        └── daily-devotional.ts (+ .test.ts)   (U8 orchestration)
```

Per-unit `**Files:**` are authoritative; the implementer may adjust layout.

---

## Implementation Units

### U1. Env config + shared types

**Goal:** Add devotional env vars/getters and the shared domain types.

**Requirements:** foundation for all units.

**Dependencies:** none.

**Files:** `apps/mastra/src/config/env.ts`, `apps/mastra/src/config/env.test.ts`,
`apps/mastra/src/services/devotional/types.ts`, `apps/mastra/.env.example`.

**Approach:** All new vars `.optional()` (opt-in scaffolding rule; never added to
`assertMastraRuntimeEnv()`). Add `DEVOTIONAL_SITE_INGEST_URL` + `_TOKEN` (publish
target), `DEVOTIONAL_PARTNER_DOMAINS` (CSV grounding allowlist),
`DEVOTIONAL_DEFAULT_VIDEO_ID` (A8 fallback), and a devotional LLM model var
defaulting to the existing OpenRouter model. Reuse `getFirecrawlConfig()` (news +
partner grounding) and the OpenRouter provider config. Define `Hook`,
`ScriptureRef`, `VideoClip`, `Devotional`, `SafetyVerdict`, `DevotionalReport`.

**Patterns to follow:** the Firecrawl/site-ingest env block added for discovery;
`getInstagramSiteIngestConfig()`.

**Test scenarios:**

- Getters return configured values; absent optional vars → `undefined`/null config.
- `DEVOTIONAL_PARTNER_DOMAINS` parses CSV to a trimmed list; empty → empty list.
- A devotional run with no site-ingest config still computes (publish skipped).

---

### U2. Hook picker service

**Goal:** Pick today's hook — news (prominent), holiday/Christian-calendar, or an
intriguing-question fallback.

**Requirements:** daily hook with priority order.

**Dependencies:** U1.

**Files:** `apps/mastra/src/services/devotional/hook-picker.ts` (+ `.test.ts`).

**Approach:** Given a date + injectable Firecrawl search + injectable LLM, produce
a `Hook { type: "news"|"holiday"|"question", title, summary, sourceUrl? }`. News:
Firecrawl web search for recent notable events; LLM picks one broadly-relevant
item and frames it neutrally (no partisan specifics). Holiday: a small static
Christian-calendar/holiday table keyed by date. Fallback: LLM-generated intriguing
question. Date and both clients are injected for deterministic tests.

**Patterns to follow:** `firecrawl-search-client.ts` usage in the discovery
workflow; `judge.ts` OpenRouter call shape.

**Test scenarios:**

- Returns a `news` hook when search yields events and the LLM selects one (mocked).
- Returns a `holiday` hook when the date matches the calendar table.
- Falls back to a `question` hook when news search is empty and no holiday matches.
- News framing strips/avoids flagged partisan terms (assert the prompt/guard, mock LLM).
- Firecrawl failure → falls back to holiday/question, never throws out of the run.

---

### U3. Scripture selector service

**Goal:** Choose a scripture passage that coheres with the day's hook.

**Requirements:** scripture passage tied to the hook.

**Dependencies:** U1, U2.

**Files:** `apps/mastra/src/services/devotional/scripture-selector.ts` (+ `.test.ts`).

**Approach:** Given the hook + injectable LLM, return a `ScriptureRef { reference,
text, translation? }`. The passage is small and focused. Per A5, the canonical
text source is confirmed at exec time; for now the LLM proposes a reference and
short quote, and the report flags it as needs-canonical-source so we never present
an unverified paraphrase as authoritative.

**Patterns to follow:** `judge.ts` structured OpenRouter call.

**Test scenarios:**

- Returns a reference + passage for a given hook (mocked LLM).
- Reference is well-formed (book chapter:verse shape) — reject/repair malformed output.
- Carries the `needs-canonical-source` flag through to the report (A5).
- LLM failure surfaces as a typed error the workflow can handle.

---

### U4. Video matcher service

**Goal:** Find a relevant Jesus Film library clip for the passage/theme; apply the
always-a-clip fallback.

**Requirements:** relevant clip, always present.

**Dependencies:** U1, U3.

**Files:** `apps/mastra/src/services/devotional/video-matcher.ts` (+ `.test.ts`).

**Approach:** Given the scripture/theme + an injectable search client, query admin
semantic search for a clip and return the top result above a relevance threshold
as `VideoClip { videoId, title, url, thumbnailUrl }`. Below threshold or on error
→ the configured `DEVOTIONAL_DEFAULT_VIDEO_ID` fallback (A8), recording
`videoMatch: "search"|"fallback"|"none"` for the report.

**Patterns to follow:** `admin-search-eval-client.ts` (Mastra→admin HTTP search,
bearer auth, typed errors, timeout).

**Test scenarios:**

- Returns the top clip when search yields a result above threshold (mocked).
- Below-threshold result → fallback clip; `videoMatch: "fallback"`.
- Search error/timeout → fallback clip, never throws; `videoMatch: "fallback"`.
- No fallback configured + no match → `videoMatch: "none"` (workflow decides; A8).

---

### U5. Devotional writer service

**Goal:** Compose the original reflection (grounded in partner teaching), the
reflection questions, the optional further-reading link, and the **flexible
per-day block order**.

**Requirements:** original reflection, reflection questions, flexible structure,
partner grounding + optional link.

**Dependencies:** U1, U2, U3, U4.

**Files:** `apps/mastra/src/services/devotional/devotional-writer.ts` (+ `.test.ts`).

**Approach:** Given hook + scripture + video + injectable Firecrawl (partner
grounding) + injectable LLM, produce a `Devotional`. Grounding: search the
`DEVOTIONAL_PARTNER_DOMAINS` allowlist for reliable teaching on the theme; pass as
context; instruct the LLM to write **original** prose (never copy) and optionally
return one partner URL as `furtherReading`. `blockOrder` is chosen from a set of
allowed arrangements (e.g. video-first vs hook-first permutations) varied by date
so output is non-formulaic. Returns reflection text, `questions[]`, `furtherReading?`,
`blockOrder[]`.

**Patterns to follow:** `judge.ts` OpenRouter call; discovery classifier's
allowlist/config style for partner domains.

**Test scenarios:**

- Produces reflection + 2–3 questions + blockOrder from full inputs (mocked).
- `blockOrder` varies with the date (two dates → different arrangements) and is
  always a valid permutation containing every present ingredient.
- `furtherReading`, when present, is one of the partner-domain URLs (allowlist enforced).
- Partner-grounding search failure → still writes (grounding is best-effort), no link.
- Output excludes verbatim partner text (assert the prompt contract / guard).

---

### U6. Safety gate (doctrinal + tone/sensitivity)

**Goal:** The load-bearing automated check that decides whether a devotional may
auto-publish.

**Requirements:** automated doctrinal + tone/sensitivity safety net (R: auto-publish
with a safety net). This is the highest-risk unit.

**Dependencies:** U1, U5.

**Files:** `apps/mastra/src/services/devotional/safety-gate.ts` (+ `.test.ts`).

**Approach:** LLM-as-judge over the finished devotional. Returns `SafetyVerdict {
verdict: "pass"|"block", scores: { doctrine, tone, sensitivity }, reasons[] }`.
Block on: doctrinal error, partisan/political stance, tragedy framed insensitively,
scripture misuse, or low confidence. Conservative bias: ambiguous → block. Reuse
the OpenRouter judge pattern; multiple checks (doctrine + sensitivity) so one lens
can't dominate. The workflow publishes ONLY on `pass`.

**Execution note:** Implement test-first — this gate is the only thing between the
bot and a public misstep on a Jesus Film page; its block conditions deserve
explicit failing tests before the implementation.

**Test scenarios:**

- Clean devotional → `pass`.
- Doctrinally wrong statement → `block` with a doctrine reason.
- Partisan political framing → `block` with a sensitivity reason.
- Tragedy framed opportunistically → `block` with a tone reason.
- Ambiguous/low-confidence judge output → `block` (conservative default).
- Judge call error/timeout → `block` (fail closed, never publish on judge failure).

---

### U7. Site publish client

**Goal:** Submit the finished, passed devotional to the watch-site Today's
Devotional ingest endpoint.

**Requirements:** published to the watch site; opt-in; best-effort.

**Dependencies:** U1, U5.

**Files:** `apps/mastra/src/services/devotional/site-publish-client.ts` (+ `.test.ts`).

**Approach:** POST the devotional payload with bearer auth; typed errors
(config_missing / auth_failed / upstream_failed / invalid_response). Returns
`{ ok, published }`. Mirrors the discovery site-ingest client exactly. No config →
no-op (publish skipped).

**Patterns to follow:** `services/discovery/site-ingest-client.ts`.

**Test scenarios:**

- Posts the devotional payload with the date key; returns published count (mocked).
- `config_missing` thrown before fetch when URL/token absent.
- 401 → auth_failed; 5xx → retryable upstream_failed.
- Payload carries hook/scripture/video/reflection/questions/blockOrder + date.

---

### U8. Orchestration workflow + artifact + launch + route

**Goal:** Compose the services into the daily workflow with a discriminated-union
result, a persisted report, a launch function, and a service-bearer route.

**Requirements:** the end-to-end daily pipeline; publish only on safety pass.

**Dependencies:** U1–U7.

**Files:** `apps/mastra/src/mastra/workflows/daily-devotional.ts` (+ `.test.ts`),
`apps/mastra/src/services/devotional/artifacts.ts` (+ `.test.ts`).

**Approach:** Mirror the discovery workflow shape: injectable `runDailyDevotional`
returning a discriminated union; Mastra steps (pick-hook → select-scripture →
match-video → write → safety → report+publish); `launchDailyDevotionalWorkflow`;
`handleDailyDevotionalRouteRequest` with `isValidServiceBearer`. On safety `block`,
return success-with-`published:false` and persist a blocked report (do NOT publish).
Statuses: 200 ok, 400 invalid_input, 503 config_missing (no LLM key), 502
generation_failed. Artifact store mirrors discovery `artifacts.ts` (bounded Zod,
atomic write).

**Patterns to follow:** `mastra/workflows/instagram-ai-christian-discovery.ts`
(failure-prefix mechanism, steps, route handler, best-effort submit);
`services/instagram-discovery/artifacts.ts`.

**Test scenarios:**

- Happy path: all steps succeed, safety passes → published, artifact written.
- Safety blocks → `published:false`, blocked report persisted, publish NOT called.
- `config_missing` when no LLM key configured (no external calls).
- A step failure (e.g. scripture) → `generation_failed` (retryable), report records the stage.
- Video fallback path (A8) flows through to a published devotional.
- Route handler: invalid bearer → 401; valid → 200; JSON parse failure → 400;
  config_missing → 503; generation_failed → 502.
- Idempotency: two runs for the same date don't double-publish (date is the dedupe key).

---

### U9. Register workflow + route; docs

**Goal:** Wire into the Mastra app and document the workflow, env vars, and the
external-cron + watch-site dependencies.

**Requirements:** operability.

**Dependencies:** U8.

**Files:** `apps/mastra/src/mastra/index.ts`, `apps/mastra/CLAUDE.md`,
`apps/mastra/.env.example`.

**Approach:** Add `dailyDevotionalWorkflow` to `workflows` and register
`POST /forge-daily-devotional` (same Response block as other `/forge-*` routes).
Document the env vars, the `POST` contract, the external daily-cron trigger (A6),
the LLM-judge safety gate (and its fail-closed behavior), and the watch-site
ingest dependency (A7).

**Test scenarios:** `Test expectation: none` — registration + docs; behavior is
covered by U8's route tests.

**Verification:** `pnpm --filter @forge/mastra typecheck`, `lint`, `test` pass;
`POST /forge-daily-devotional` with a valid bearer returns a devotional result;
invalid/no bearer → 401.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- The watch-site "Today's Devotional" **page + ingest/store endpoint** (web team;
  contract mirrors discovery site-ingest).
- Confirming the **production video-search endpoint** for Mastra (A2) and the
  **canonical Bible-text source** (A5).
- Consolidating the safety gate onto **feat-067 Doctrinal Validation Engine** when
  it ships.

### Deferred for later (from origin)

- Multilingual devotionals; news-day human approval/restrictions; an archive of
  past devotionals; email/social distribution; on-site reader interaction.

### Outside this product's identity (from origin)

- Republishing partner content; publishing anything the safety gate rejected;
  taking a partisan political position.

---

## System-Wide Impact

- **apps/mastra:** one new workflow + route, a devotional service module, reuse of
  Firecrawl + admin-search + OpenRouter. No change to existing workflows.
- **Watch experiment site (separate, web team):** a Today's Devotional page + an
  ingest endpoint + an unpublish/edit control.
- **Ops:** a daily cron trigger; new optional env vars; an LLM-judge that fails
  closed (a judge outage means no devotional that day, which is the safe failure).

---

## Risk Analysis & Mitigation

- **Safety gate is the only guard before public auto-publish (by design).**
  Mitigations: fail-closed on judge error/ambiguity (U6), conservative block bias,
  multi-lens judge, easy web-side pull/edit, documented escalation to human
  approval / disabling news if it misbehaves. Highest-attention unit.
- **Unverified scripture text** presented as authoritative (A5). Mitigation:
  reference + needs-canonical-source flag until a canonical source is wired.
- **Forced weak video match.** Mitigation: threshold + default-clip fallback (A8),
  recorded in the report for review.
- **Partner copyright.** Mitigation: grounding-only contract, allowlist, original
  text, link-not-quote (U5).
- **Timely content aging badly.** Mitigation: it's "today's", short shelf life,
  easy pull.

---

## Alternative Approaches Considered

- **One workflow with internal steps (chosen)** vs. several independent workflows.
  Chosen because the steps form one strict daily pipeline with shared context;
  separate workflows would add orchestration overhead with no isolation benefit.
  Services stay separately testable, mirroring the discovery pattern.
- **In-app scheduler** vs. external cron (chosen). No in-app cron exists in Mastra;
  external cron hitting the route matches the established trigger pattern and keeps
  the workflow on-demand/testable.
