---
title: "Watch Organic Search Recovery - Plan"
type: fix
date: 2026-08-28
topic: watch-organic-search-recovery
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Watch Organic Search Recovery - Plan

## Goal Capsule

- **Objective:** Recover avoidable Watch organic-search click loss without mistaking normal demand changes or canonical migration reporting for a product defect.
- **Means:** Extend the existing Mastra SEO audit/report pipeline with an operator-triggered, release-aligned comparison mode; validate each high-loss canonical family against the public route contract; and route only evidence-supported fixes into the existing proposal and experiment ledger.
- **Product authority:** Linear FGE-116 and `docs/roadmap/topic-experiences/feat-442-watch-organic-traffic-recovery.md` own this scope.
- **Open blockers:** None. Authenticated Search Console API access is available through the existing read-only client; no manual export is required.

---

## Product Contract

### Summary

Add a repeatable Watch organic-search recovery workflow that separates URL migration, query demand, result click-through, ranking, and indexability effects. The workflow produces ranked canonical-family findings and routes each finding to a measured metadata experiment, a technical indexing fix, or a no-code monitoring conclusion.

### Problem Frame

Watch clicks fell from 102,856 to 71,676 in the 2026-05-27 through 2026-08-26 comparison, while impressions fell from 13,014,992 to 11,257,450, CTR fell from 0.8% to 0.6%, and average position stayed nearly flat at 7.4 to 7.5. The window spans the May 28 `.html` route-contract release, the July 24 contextual-sitemap cleanup, and the July 25 language-less English canonical consolidation.

The JESUS film page demonstrates why raw page rows are not enough. The explicit-English URL lost traffic while the language-less canonical gained traffic, and URL Inspection now shows Google accepting the intended canonical relationship. Search Console normally attributes duplicate-page data to the canonical, but attribution can shift during a migration. Adding the two rows or blaming the canonical release without release-aligned daily and query segmentation would overstate causality.

### Key Decisions

- **Evidence gate before route changes.** A release-aligned decomposition decides whether a URL, metadata, content, or no-code response is warranted. Governs R1-R7.
- **Canonical families are the analysis unit.** Compatibility, contextual, and canonical forms are evaluated together so migration does not look like independent page loss. Governs R2, R3, R5.
- **Keep explicit English compatible for this scope.** The July contract retains it as a direct 200 alias; this recovery work may recommend reopening that decision but does not silently redirect it. Governs R4, R9.
- **CTR and impressions outrank average-position narratives.** The nearly flat property-level position does not rule out query-level losses, but it makes a ranking-only fix an unsupported default. Governs R1, R5-R8.

### Requirements

**Comparable evidence**

- R1. The workflow must compare daily and weekly clicks, impressions, CTR, and average position across the incident window, the immediately preceding equivalent period, and a year-over-year period when Search Console has comparable data.
- R2. The workflow must issue separate, bounded Search Analytics requests for page/query/date and for supported device, country, and search-appearance slices; it must not imply that all dimensions can be requested together. Every slice must record dimensions, filters, row limit, pagination/finality metadata, and Search Console anonymized-query or top-row limits.
- R3. Page rows must map to a canonical family that distinguishes canonical, explicit-language compatibility, contextual, redirect source, and unknown URL forms.
- R4. The timeline must mark the May 28 `.html` alignment, July 24 contextual-sitemap cleanup, and July 25 English canonical consolidation without treating temporal overlap as causation.

**Diagnosis and prioritization**

- R5. The report must rank canonical families and query clusters by attributable click loss, then report formula-versioned impression and CTR effects plus a residual/position signal as descriptive, non-causal contributions.
- R6. Each ranked finding must state an evidence strength, competing explanation, affected URLs and queries, and the smallest reversible response.
- R7. The JESUS canonical family must be evaluated as one group and must show pre-cutover, cutover, and post-cutover behavior for both language-less and explicit-English forms.

**Response routing**

- R8. High-impression, low-CTR findings with stable query-level position must route to metadata or intent-alignment experiments with a predeclared comparison window and guardrails.
- R9. Canonical, sitemap, hreflang, redirect, or internal-link inconsistencies must route to technical fixes that preserve the documented compatibility contract unless a separate decision reopens it.
- R10. Impression declines attributable to query demand, seasonality, geography, or device mix must produce a monitoring or content recommendation rather than an unrelated routing change.
- R11. Position or indexing declines must route to URL Inspection, sitemap/index coverage, renderability, and content-equivalence checks before metadata experiments.

**Verification and handoff**

- R12. The workflow must emit a machine-readable result and a concise human report from the same validated input.
- R13. Every shipped experiment or fix must define its Search Console baseline, release date, evaluation date, success threshold, rollback condition, and owner.
- R14. Post-release validation must check the canonical and compatibility URL responses, page identity, sitemap membership, and Search Console canonical selection for the affected family.

### Key Flows

- F1. Diagnose the decline
  - **Trigger:** An authorized Manager operator starts a dry-run recovery audit with a Watch scope, current/comparison windows, and optional release markers.
  - **Steps:** Mastra queries bounded Search Console slices, validates completeness metadata, maps URLs to canonical families, attaches release markers, calculates loss contributions, and ranks findings.
  - **Outcome:** The report distinguishes migration attribution, demand, CTR, position, and technical-indexing hypotheses.
  - **Covered by:** R1-R7, R12.
- F2. Route a finding
  - **Trigger:** A ranked family crosses the declared materiality threshold.
  - **Steps:** Apply the response rules, record competing explanations, and select the smallest reversible experiment, fix, or monitoring/no-code response.
  - **Outcome:** The finding becomes an evidence-backed change proposal or an explicit no-code conclusion.
  - **Covered by:** R6, R8-R11, R13.
- F3. Validate recovery
  - **Trigger:** A selected change reaches production through the normal PR-to-main flow.
  - **Steps:** Verify public route identity immediately, then compare Search Console performance after sufficient recrawl and query volume.
  - **Outcome:** Keep, iterate, or roll back the change using its predeclared threshold.
  - **Covered by:** R13, R14.

### Quantitative Baseline

| Metric           | Current three months | Previous three months |                 Change |
| ---------------- | -------------------: | --------------------: | ---------------------: |
| Clicks           |               71,676 |               102,856 |                 -30.3% |
| Impressions      |           11,257,450 |            13,014,992 |                 -13.5% |
| CTR              |                 0.6% |                  0.8% | -0.2 percentage points |
| Average position |                  7.5 |                   7.4 |                   -0.1 |

At the current impression volume, restoring 0.2 percentage points of CTR is worth about 22,515 clicks. This is a directional opportunity size, not proof that title or description changes can recover all of it.

### Acceptance Examples

- AE1. **Covers R3, R5, R7.** Given `/watch/jesus.html/english.html` loses clicks while `/watch/jesus.html` gains them around July 25, when the analyzer ranks pages, then it reports one JESUS canonical family and preserves the per-form timeline instead of counting the migration as two unrelated pages.
- AE2. **Covers R8, R13.** Given a query cluster keeps comparable impressions and position but loses CTR, when it crosses the materiality threshold, then the output proposes a metadata or intent-alignment experiment with a fixed baseline, evaluation window, success threshold, and rollback rule.
- AE3. **Covers R9, R14.** Given a high-loss canonical URL is absent from sitemap output or a compatibility page publishes conflicting canonical identity, when the production probe confirms the defect, then the output routes it to a technical fix and names the failing invariant.
- AE4. **Covers R10.** Given impressions fall in one seasonal query cluster while position and result CTR remain stable, when the periods are compared year over year, then the workflow records demand decline and does not propose a redirect or metadata rewrite.
- AE5. **Covers R11.** Given position drops only on mobile video results, when the finding is triaged, then URL Inspection, video/search appearance, renderability, and device-specific index evidence are required before a page-copy experiment.

### Success Criteria

- The top 80% of observed Watch click loss is assigned to canonical families or explicitly labeled as unavailable because of Search Console privacy/truncation.
- Every top-ten family has one primary driver classification and at least one competing explanation.
- No code or metadata change is recommended solely from property-level average position or from separate canonical/compatibility page rows.
- A production change is considered promising only after canonical/index checks pass and its targeted clicks or CTR improve by at least 10% relative to the predeclared comparison, without a greater than 5% loss in impressions or average position for the same query-family cohort.

### Scope Boundaries

- Do not change the canonical public URL grammar as a default response to this report.
- Do not redirect the explicit-English compatibility route inside this scope.
- Do not mix paid, social, direct, or referral acquisition into Search Console organic-search conclusions.
- Do not promise recovery from seasonal or demand-driven impression loss.
- Do not run multiple metadata experiments on the same canonical family at once.
- Do not publish Search Console query exports containing sensitive or low-volume data into the repository.

### Dependencies and Assumptions

- The existing Google Search Console OAuth/service-account configuration and read-only Search Analytics client remain the only credential and API boundary; raw exports are not committed or uploaded through Manager.
- Search Console page data is usually assigned to Google's canonical URL, so migration-period interpretation must preserve URL-form timelines.
- Google may need weeks to recrawl and consolidate changed URLs; evaluation windows must be volume- and recrawl-aware rather than fixed to a few days.
- Search result appearance changes outside the site can affect CTR and must remain a competing explanation.

### Sources and Research

- `docs/roadmap/topic-experiences/feat-442-watch-organic-traffic-recovery.md`
- `docs/plans/2026-07-25-001-fix-watch-language-less-english-canonical-plan.md`
- `apps/web/src/lib/routes.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/experience-metadata.ts`
- `apps/web/src/lib/watch-sitemap.ts`
- `apps/web/src/lib/watch-url-probe.ts`
- `docs/plans/2026-08-01-001-feat-mastra-seo-marketing-agent-plan.md`
- `docs/solutions/architecture-patterns/mastra-seo-experiment-ledger-boundary.md`
- `apps/mastra/src/services/google-search-console-client.ts`
- `apps/mastra/src/mastra/tools/seo-analysis.ts`
- `apps/mastra/src/mastra/workflows/seo-daily-audit.ts`
- `apps/mastra/src/services/seo-run-report.ts`
- `apps/admin/src/services/seo-experiment.service.ts`
- `apps/admin/src/graphql/types/managerSeo.ts`
- `apps/manager/src/features/seo/seo-run-detail.tsx`
- Google Search Central: `https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes`
- Google Search Central: `https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls`
- Search Console Help: `https://support.google.com/webmasters/answer/17011259`
- Search Console Help: `https://support.google.com/webmasters/answer/17011165`

---

## Planning Contract

### Product Contract preservation

The Product Contract is unchanged. Planning narrows the mechanism to the existing Mastra → Admin → Manager SEO boundary and corrects the intake flow from a manual export to bounded API requests.

### Key Technical Decisions

- **KTD1 — Extend the existing SEO authority boundary.** Mastra remains evidence/orchestration, Admin remains the durable run/experiment authority, Manager remains the operator surface, and Search Console remains the performance authority. Do not add a web-local CSV script, a second ledger, or repository-stored query data.
- **KTD2 — Add an explicit recovery-audit mode.** Keep the scheduled daily audit's proposal behavior stable. Add an operator-triggered recovery workflow whose inputs include Watch scope, current/comparison windows, optional year-over-year window, and named release markers; register it beside `seoDailyAuditWorkflow` in Mastra.
- **KTD3 — Analyze canonical families deterministically.** A dedicated analyzer maps a normalized Watch URL into `canonical`, `explicit-language-compatibility`, `contextual`, `redirect-source`, or `unknown`. For eligible English films, both `/watch/<film>.html` and `/watch/<film>.html/english.html` share the language-less family key. Unknown forms stay visible and never get silently folded.
- **KTD4 — Decompose loss from comparable cohorts.** Calculate current and comparison metrics from the same page/query cohort and scope. Report impression effect, CTR effect, and a residual/position signal as descriptive contributions; do not claim causal attribution from the arithmetic. Store the formula version with the report and cover zero-impression/zero-click cases in tests.
- **KTD5 — Keep API limits explicit.** Use multiple supported dimension slices rather than one impossible all-dimension query. Record each request's window, dimensions, filters, row count/limit, pagination and freshness/finality state. A truncated or incomplete slice lowers evidence strength and cannot trigger an automated proposal.
- **KTD6 — Keep model judgment downstream of facts.** URL grouping, period comparison, thresholds, driver classification, and response eligibility are deterministic. An LLM may summarize competing explanations, but it cannot invent metrics, change classification, activate an experiment, or bypass the existing approval boundary.
- **KTD7 — Dry-run first.** The first release only creates a bounded run report and Manager readout. It neither changes Watch routes/metadata nor creates or activates experiments automatically. An operator may promote a reviewed finding through the existing proposal/experiment workflow.
- **KTD8 — Preserve the July route contract.** Explicit English remains a direct 200 compatibility route with canonical identity pointing at the language-less English URL. Redirecting it, changing public URL grammar, or restoring contextual sitemap ownership requires a separate product/technical decision.

### Data flow

```text
Manager recovery request
        │ authorized internal action
        ▼
Mastra recovery workflow ── bounded read-only requests ──► Search Console
        │
        ├─ canonical-family mapper + deterministic comparison
        ├─ public URL identity checks for material findings
        ▼
versioned, size-bounded SEO run report
        │
        ▼
Admin durable run authority ──► Manager reviewed readout
                                      │
                                      └─ optional existing proposal/experiment flow
```

### Sequencing and stop conditions

1. Land the typed evidence and analysis contract before adding workflow or UI consumers.
2. Land the workflow/report persistence contract before rendering its new fields in Manager.
3. Release in dry-run mode and reproduce the supplied three-month aggregate plus the JESUS family split before using findings for work selection.
4. Stop and report `insufficient_evidence` when required slices are incomplete, the current/comparison scopes differ, canonical-family coverage is below 80% of observed click loss, or the public route probe contradicts the stored identity.

No database migration is expected: the existing versioned JSON report is the persistence boundary. If the bounded report cannot carry the new comparison section without unsafe compaction, stop and version/resize the report contract deliberately rather than dropping evidence silently.

## Implementation Units

### U1 — Typed comparison evidence and completeness metadata

**Goal:** Make two or three comparable Search Console windows and their limitations first-class inputs.

**Files:**

- Modify `apps/mastra/src/services/google-search-console-client.ts`
- Modify `apps/mastra/src/services/google-search-console-client.test.ts`
- Modify `apps/mastra/src/mastra/tools/seo-evidence.ts`
- Modify `apps/mastra/src/mastra/tools/seo-evidence.test.ts`

**Approach:**

- Extend the supported-dimension union only for dimensions confirmed by the Search Analytics API used by this client; keep unsupported UI-only dimensions out of the type.
- Return/request-log enough metadata to distinguish complete, paginated, top-row-limited, fresh/incomplete, and failed slices.
- Add a comparison-evidence helper that issues identical filters for current, preceding-equivalent, and optional year-over-year windows. Page/query/date is the primary loss slice; device, country, and search appearance are separate diagnostic slices.
- Preserve the existing Pacific-time/date semantics and read-only OAuth scope.

**Test scenarios:** mismatched window length rejected; identical filters preserved; pagination and row limits surfaced; incomplete data lowers status; unsupported dimension rejected; empty-but-complete slice distinguished from failed/unobserved.

### U2 — Watch canonical-family mapping and loss analysis

**Goal:** Produce deterministic, explainable family findings without changing Watch routing.

**Files:**

- Create `apps/mastra/src/mastra/tools/seo-organic-recovery-analysis.ts`
- Create `apps/mastra/src/mastra/tools/seo-organic-recovery-analysis.test.ts`
- Modify `apps/mastra/src/mastra/tools/seo-analysis.ts` only to share existing target/observation schemas rather than duplicate them
- Read as contract evidence, but do not modify by default: `apps/web/src/lib/routes.ts`, `apps/web/src/lib/watch-url-probe.ts`, and `apps/web/src/lib/watch-sitemap.ts`

**Approach:**

- Derive eligible canonical URLs from existing SEO targets and normalize Watch URL forms using the same grammar asserted by Web route/probe tests.
- Preserve per-form time series inside each family and attach named release markers.
- Rank by lost clicks, report family coverage, and calculate formula-versioned impression/CTR/residual contributions from matched cohorts.
- Emit a finite driver/response enum: `migration_attribution`, `demand_or_mix`, `ctr_intent`, `ranking_or_indexing`, `technical_identity`, or `insufficient_evidence`; pair it with evidence strength, competing explanation, and reversible next action.

**Test scenarios:** JESUS forms group without double counting; unrelated languages do not group; contextual and unknown forms remain visible; cutover buckets are correct; division-by-zero is stable; aggregate reconciliation is within documented rounding; incomplete slices cannot yield a change recommendation.

### U3 — Operator-triggered dry-run workflow and versioned report

**Goal:** Execute recovery analysis through the existing SEO orchestration and persistence boundaries.

**Files:**

- Create `apps/mastra/src/mastra/workflows/seo-organic-recovery-audit.ts`
- Create `apps/mastra/src/mastra/workflows/seo-organic-recovery-audit.test.ts`
- Modify `apps/mastra/src/mastra/index.ts`
- Modify `apps/mastra/src/services/seo-run-report.ts`
- Modify `apps/mastra/src/services/seo-run-report.test.ts`
- Modify `apps/mastra/src/services/admin-seo-client.ts` and its focused tests if the existing create/finish-run input must expose the new mode

**Approach:**

- Define a strict input schema for site/Watch scope, ISO dates, optional year-over-year dates, and release markers; reject future, overlapping, unequal, or overlarge windows.
- Record a `recoveryComparison` section in the versioned, byte-bounded report: request manifest, reconciliation, family findings, formulas, evidence limitations, and dry-run status.
- Reuse existing run lifecycle, error normalization, report projection, and Admin client. Preserve current daily audit output for backward compatibility.
- On partial failure, persist the successful request manifest and an explicit unavailable reason; never convert missing observations into zeros.

**Test scenarios:** supplied May 27–Aug 26 aggregate and JESUS split reproduce; invalid scopes fail closed; partial GSC failure is reportable; projection compacts low-priority rows before summary/reconciliation; daily-audit report remains parseable.

### U4 — Admin storage and GraphQL projection

**Goal:** Persist and expose recovery results without weakening authorization, retention, or report-size controls.

**Files:**

- Modify `apps/admin/src/services/seo-experiment.service.ts`
- Modify `apps/admin/src/services/seo-experiment.service.test.ts`
- Modify `apps/admin/src/graphql/types/managerSeo.ts`
- Modify focused GraphQL tests adjacent to `managerSeo.ts`
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` gql.tada outputs through repository commands; never hand-edit generated env files

**Approach:**

- Version the stored report parser so legacy V1/daily reports remain readable while the recovery section is optional and bounded.
- Sanitize and compact raw query rows under the existing retention policy; expose aggregated query-cluster labels and metrics, not an unrestricted download endpoint.
- Project the new comparison/finding fields through the existing Manager-only SEO run authorization path.

**Test scenarios:** legacy report compatibility; new report round trip; unauthorized access unchanged; oversize findings compact deterministically; expired reports retain the existing unavailable/compacted semantics.

### U5 — Manager launch and evidence readout

**Goal:** Let an authorized operator launch a dry run and understand why each finding was classified.

**Files:**

- Modify `apps/manager/src/features/seo/seo-contract.ts`
- Modify `apps/manager/src/features/seo/seo-admin-client.ts` and `apps/manager/src/features/seo/seo-admin-client.test.ts`
- Modify `apps/manager/src/features/seo/seo-run-detail.tsx`
- Modify `apps/manager/src/features/seo/seo-run-detail.test.ts`
- Modify `apps/manager/src/features/seo/seo-runs-view.tsx` only if the existing run action cannot accept recovery-mode inputs

**Approach:**

- Add a constrained Watch recovery form with explicit current/comparison dates and optional release markers; show that it is read-only/dry-run before submission.
- Render aggregate reconciliation, completeness warnings, canonical-family rows, per-form migration timeline, driver/evidence strength, competing explanation, and smallest next action.
- Preserve compacted/unavailable run states and keyboard/semantic table accessibility. Never display or provide bulk download of raw sensitive query rows.

**Test scenarios:** valid launch payload; invalid/equal/overlapping dates; complete and incomplete evidence states; JESUS family renders both URL forms once; legacy daily run unchanged; compacted/unavailable states remain usable.

### U6 — Production identity and GSC validation runbook

**Goal:** Turn the dry-run report into a safe decision gate for FGE-116 without preselecting a code fix.

**Files:**

- Modify this plan with the final run ID and chosen response only after the dry run is reviewed
- Update `docs/roadmap/topic-experiences/feat-442-watch-organic-traffic-recovery.md` status/evidence during implementation
- No Watch production-code file is modified unless a reviewed finding identifies a specific invariant failure

**Approach:**

- Probe representative canonical and compatibility URLs for status, final URL, canonical, robots, title/description, structured-data identity, hreflang, sitemap membership, and internal-link target.
- Use URL Inspection on the top material families to compare declared and Google-selected canonicals.
- Route each reviewed finding through R8-R11. Metadata candidates enter the existing 28-day experiment ledger; technical defects get their own narrow roadmap item/PR; demand-only findings remain monitored.

**Verification:** record production timestamp, GSC request windows, release marker, inspected URLs, run ID, and decision. Do not close FGE-116 from local tests alone.

## Verification Contract

### Automated validation

- Mastra: run focused Vitest files for the GSC client, recovery analyzer/workflow, and run-report projection, then the package typecheck and lint commands defined in `apps/mastra/package.json`.
- Admin: run focused SEO experiment/GraphQL tests, regenerate `apps/admin/schema.graphql` and `packages/admin-graphql`, verify generated diffs, then run Admin and `packages/admin-graphql` typechecks.
- Manager: run focused SEO contract/client/detail tests, then Manager typecheck, lint, and format checks.
- Cross-scope: run repository format/check commands required by CI and `git diff --check`. Verify the scheduled daily audit and legacy V1 reports remain unchanged fixtures.

Implementers must use the exact package scripts present at execution time rather than hard-coding guessed script names in automation. No production deploy, Railway command, or direct main-branch publication is part of verification.

### Deterministic fixtures

- Commit synthetic fixtures, not raw Search Console exports, for the aggregate baseline and JESUS URL-family migration.
- Assert click/impression totals reconcile to fixtures, formulas carry a version, and unknown/unobserved data is never coerced to zero.
- Add contract fixtures for complete, truncated, fresh/incomplete, failed, compacted, and legacy reports.

### Production and Search Console gates

1. In production, canonical and explicit-English JESUS forms both return 200 and publish one language-less canonical identity; sitemap and internal-link ownership match the July contract.
2. The dry run reproduces the supplied property metrics within rounding and reports `/watch/jesus.html` plus `/watch/jesus.html/english.html` as one family with both form histories.
3. URL Inspection shows the intended selected canonical, or the finding is reclassified as `technical_identity` before any CTR experiment.
4. After a reviewed fix ships, wait for recrawl and at least the predeclared 28-day/200-impression cohort; compare the same query-family/device/country cohort.
5. Keep/iterate only at ≥10% targeted click or CTR lift with no >5% impression or average-position regression and no >15% GA4 engagement guardrail regression. Roll back or mark inconclusive otherwise.

## Definition of Done

- U1-U5 focused tests, typechecks, lint/format, schema generation, and backward-compatibility fixtures pass.
- An authorized dry run is persisted and visible in Manager with explicit completeness and evidence-strength states.
- The supplied Watch totals reconcile and the JESUS migration appears as one family without double counting.
- No report path exposes credentials or unrestricted raw/low-volume query data, and retention/compaction behavior is covered.
- The scheduled daily audit, existing proposals, experiment approval/activation separation, and July Watch route contract are unchanged.
- FGE-116 and the roadmap record the run ID, top ranked findings, selected response owners, production/GSC validation dates, and any narrower follow-up tickets.
- The roadmap is complete only after either a measured response meets its declared threshold or the evidence supports a documented no-code/monitoring conclusion; producing the analyzer alone is not recovery.

## Risks and rollback

- **Canonical aggregation obscures form-level history:** retain per-form timelines and page/date slices; never rank canonical and alias as separate losses.
- **Search Console truncation/privacy creates false precision:** surface coverage and limitations; fail closed on change recommendations.
- **Seasonality overlaps releases:** require preceding-equivalent and year-over-year evidence where available, and state competing explanations.
- **Report growth breaks persistence:** use versioned bounded schemas and deterministic projection; legacy reports remain readable.
- **UI encourages action before evidence:** label recovery runs dry-run and keep existing approval/activation gates.
- **A code release regresses SEO:** roll back only the narrow experiment/fix through the normal PR flow; do not revert the canonical migration absent selected-canonical evidence.
