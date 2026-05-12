# Web → Admin Cutover Runbook

> **Status:** `draft until measured`
> The mean-time-to-rollback (MTTR) section contains a `TODO` placeholder. This runbook moves from `draft` to `live` only after the operator records observed P50 and worst-case timings/impact numbers from two real flip tests. Until then, do NOT execute the cutover from this document alone — a fresh on-call engineer must be paired with the plan author.
>
> **Date stamp:** 2026-05-12 (U9 of PR-B)
> **Plan reference:** [`docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md`](../plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md)
> **Scope:** apps/web's `[slug]` watch route only. Homepage (`watchSetting`) and watch-video (`getVideoBySlug`, `getWatchVideoOperation`) stay on Strapi during this cutover window and route through Strapi's own incident response, not this runbook.

This runbook is the single source of truth for flipping forge-web from `FORGE_CONTENT_API=strapi` to `admin`, monitoring the cutover, and rolling back if anything goes sideways. Read it end-to-end before touching Doppler.

---

## Pre-cutover checklist

Tick every box before flipping the env var. The cutover is irreversible only at the cache layer (ISR will thrash for ~60s either direction); operationally, every box below has a corresponding rollback path further down. None of them is optional.

- [ ] **PR-A deployed to forge-admin production.** `CONSUMER_BEARER` principal recognition, `experienceBySlug` `isTemplate` filter, and Pothos block typings are all live. Verify by checking the admin deploy stream for the PR-A merge SHA.
- [ ] **`WEB_ADMIN_API_KEYS` set on forge-admin Doppler (CSV).** Admin recognizes each entry as a valid bearer; this is the receiver-side allowlist.
- [ ] **Symmetric `WEB_ADMIN_API_KEYS` set on forge-web Doppler.** Web reads ONE entry from admin's CSV as its outbound bearer. The variable name is intentionally identical on both sides to eliminate the KEY-vs-KEYS copy-paste error class.
- [ ] **`ADMIN_GRAPHQL_URL` healthy on forge-web.** Manual confirmation: from a workstation with the same bearer, run:

  ```sh
  curl -sS -H "Authorization: Bearer $WEB_ADMIN_API_KEY" \
       -H "Content-Type: application/json" \
       -d '{"query":"{ __typename }"}' \
       "$ADMIN_GRAPHQL_URL"
  ```

  Confirm admin recognizes the bearer (admin dashboard's rate-limit identity bucket shows up as `consumer:<key-prefix>`, not `public:<railway-egress-ip>`).

- [ ] **`apps/admin/schema.graphql` regenerated and committed.** PR-A landed this; verify the file's mtime on the deployed admin matches the PR-A merge commit.
- [ ] **`packages/graphql/src/admin-graphql-env.d.ts` regenerated.** PR-A landed this too; verify by `git log packages/graphql/src/admin-graphql-env.d.ts` shows the PR-A commit.
- [ ] **Batch verification harness gate is green.** Latest run of `pnpm --filter @forge/graphql run-batch-verification` produces empty (or fully allow-listed) diff output. See [batch-verification harness](../../packages/graphql/scripts/run-batch-verification.ts) (U8).
- [ ] **Editorial freeze coordinated** for the 24-48h window between gate-green and env-flip — OR an `--since <last-full-run-ts>` delta-run confirms no new diffs were introduced just before the flip. The gate is only meaningful if content state is stable between gate-green and env-flip; without one of those two, R5 isn't actually a gate.

---

## Concurrent-backend exposure note

During the cutover window, forge-web has **two live backends serving the same user session**:

| Surface                                                  | Backend (during cutover)   | Backend (post-cutover, pre-Strapi-removal) |
| -------------------------------------------------------- | -------------------------- | ------------------------------------------ |
| `/[slug]` watch page                                     | Strapi → admin (this flip) | admin                                      |
| Homepage (`watchSetting`)                                | Strapi                     | Strapi (until separate migration)          |
| Watch video (`getVideoBySlug`, `getWatchVideoOperation`) | Strapi                     | Strapi (until separate migration)          |

Implications:

- A **Strapi outage** during the window breaks homepage + watch-video but does NOT break `/[slug]`. Rollback layers below are for slug-page outages only.
- An **admin outage** breaks `/[slug]` but does NOT break homepage. Layers 1-2 below address this.
- Both backends must outlast TV burn-in completion before Strapi can shut down. Do not request Strapi sunset until TV is live AND a separate plan migrates the homepage / watch-video surfaces. See plan-003 Dependencies/Assumptions.

---

## Mean-time-to-rollback measurement

> **TODO(MTTR):** operator action required before this runbook publishes. Numbers below are placeholders.

Before flipping `FORGE_CONTENT_API` to `admin` in prod, run **two test flips** between `strapi` and `feature-flag-maintenance` (i.e., `FORGE_DISABLE_WATCH_ROUTES` set to a canary slug) on forge-web. Measure for each flip:

| Metric                             | Definition                                                                 | P50    | Worst-case |
| ---------------------------------- | -------------------------------------------------------------------------- | ------ | ---------- |
| End-to-end deploy time             | env save → deploy trigger → container build → health-check → traffic shift | `TODO` | `TODO`     |
| Request 5xx-rate during flip       | Vercel/Railway response codes during the build/redeploy window             | `TODO` | `TODO`     |
| Cache thrash duration              | seconds of mode-mixed serves before ISR converges                          | `TODO` | `TODO`     |
| Maintenance-fallback response time | TTFB when `FORGE_DISABLE_WATCH_ROUTES` engages                             | `TODO` | `TODO`     |

**Escalation thresholds:**

- If worst-case deploy time exceeds **10 minutes**, escalate before cutover. The fast-rollback story (layer 1) depends on a sub-10-minute redeploy budget.
- If user-impact 5xx-rate exceeds **5%** during the flip, escalate before cutover. Operators care about user impact, not just deploy seconds.

The operator who runs these measurements is responsible for replacing `TODO` with observed values **before** opening the runbook to a fresh on-call engineer.

---

## Cutover procedure

Five-step sequential. Do not skip steps; do not parallelize.

1. **Verify gate is green + editorial freeze in effect** (or `--since` delta-run is empty). See pre-cutover checklist.
2. **Flip `FORGE_CONTENT_API` to `admin`** on forge-web Doppler.

   ```sh
   # On the operator's workstation, authenticated to Doppler.
   doppler secrets set --project forge-web --config prd FORGE_CONTENT_API=admin
   ```

3. **Trigger redeploy.** Railway auto-redeploys on env change in most projects; verify the deploy actually fired by watching the Railway dashboard for forge-web. If the deploy did not auto-trigger, manually re-deploy the current build.
4. **Monitor admin error rate + page-render success rate** in Railway logs for the first **30 minutes**. See [Monitoring queries](#monitoring-queries) below.
5. **Confirm the `consumer:` bucket** is the dominant rate-limit identity on the admin dashboard. Pre-cutover, web's SSR traffic shows up as `public:<railway-egress-ip>` (because no bearer). Post-cutover, the `consumer:<key-prefix>` bucket should dominate. If `public:` traffic remains dominant, web is missing the bearer header — investigate `WEB_ADMIN_API_KEYS` deploy ordering before allowing the cutover to settle.

---

## Rollback layers

Listed in escalation order. **Use the lowest-numbered layer that resolves the regression.** Higher layers are progressively more invasive.

### Layer 1 — `FORGE_DISABLE_WATCH_ROUTES` (seconds, fastest)

CSV of route paths to disable. Matched against the requested slug at `apps/web/src/app/[slug]/page.tsx` module scope; matching slugs render `<MaintenanceFallback>` instead of fetching from admin or Strapi.

```sh
# Disable specific slugs while admin debugs:
doppler secrets set --project forge-web --config prd \
  FORGE_DISABLE_WATCH_ROUTES='/some-broken-slug,/another-broken-slug'

# Disable everything (broad rollback):
# (set the var to a wildcard sentinel — currently not supported; use
# layer 2 instead. The flag is for surgical route disable, not blanket.)
```

Properties:

- Reads at module scope (NEVER via `headers()` / `cookies()` — that would defeat Next's Full Route Cache; see `docs/solutions/web/nextjs-headers-defeats-route-cache.md`).
- Maintenance page is static text — no admin/Strapi fetch, no dynamic data. Failsafe.
- Emergency only. NOT a traffic-shaping mechanism. Do not leave a slug in this list longer than a debug session.
- Unknown CSV values warn-and-fall-through to normal rendering — typo'd entries don't brick the route.

### Layer 2 — Revert `FORGE_CONTENT_API` to `strapi` (minutes)

```sh
doppler secrets set --project forge-web --config prd FORGE_CONTENT_API=strapi
# Wait for Railway redeploy (see MTTR section for the budget).
```

Properties:

- Only works **while Strapi service is still live**. Post-Strapi-removal, this layer is gone — escalate directly to layer 3.
- If `WEB_ADMIN_API_KEYS` is somehow missing/invalid when this layer fires, U6's runtime safety net falls through to Strapi semantics for the bearer-missing path automatically. Expected to be a no-op during the cutover window.
- Time-bound: depends on Railway redeploy time (see MTTR).

### Layer 3 — Code-revert the PR-B cutover commit (5-15 min)

Use when the regression is in apps/web code that PR-B shipped (admin-shape fragments, `fetchSlugExperience` branch, error boundary, etc.) and layers 1-2 are insufficient.

```sh
# On a workstation with main checked out:
git revert <PR-B-merge-commit-sha> --no-edit
git push origin main
# Railway auto-deploys main; verify the revert lands and Strapi-mode is active.
```

Properties:

- Drops PR-B's code; web reverts to Strapi-only consumer behavior.
- Does NOT touch admin (that's layer 4).
- Time-bound: depends on Railway redeploy time.

### Layer 4 — PR-A regression: revert admin SDL (last resort)

Use **only** when the regression source is PR-A (e.g., Pothos block types cause a downstream consumer to break, the `CONSUMER_BEARER` principal mis-routes auth, etc.). Layers 1-3 are insufficient because they only revert web — admin's SDL is unchanged.

> **Order matters.** Sequence layer 4 **only after** layer 3 has reverted web back to Strapi mode. Otherwise admin's SDL revert blast radius extends past slug-page to any other consumer of admin's typed blocks (web, manager, any future consumers).

Steps:

```sh
# (a) Revert the PR-A commit on forge-admin.
git revert <PR-A-merge-commit-sha> --no-edit
# (b) Regenerate admin's printed schema.
pnpm --filter @forge/admin schema:print
# (c) Regenerate the consumer-side types in packages/graphql.
pnpm --filter @forge/graphql generate
# (d) Commit the regenerated files and push.
git add apps/admin/schema.graphql packages/graphql/src/admin-graphql-env.d.ts
git commit -m "revert: PR-A admin SDL — regenerated schema"
git push origin main
# (e) Wait for forge-admin to redeploy.
```

Properties:

- Reverses `ExperienceLocale.blocks` from `[ExperienceBlock!]!` back to `JSON`.
- Breaks **any** consumer of admin's typed blocks. Currently that's just web (in Strapi mode this revert is invisible), but manager and any future consumer will see the type widen.
- Layer 3 must complete before layer 4 starts. If web is still in admin mode when admin's SDL reverts, slug-page crashes at type-check boundary.

---

## No degraded hybrid mode — escalation reminder

There is **no per-request "try admin, fall back to Strapi" runtime mode**. The R3 + plan-003 "No degraded hybrid mode" KTD collapses `FORGE_CONTENT_API` to two values (`strapi | admin`), period.

If admin partially regresses on a subset of slugs during burn-in:

1. **First reflex:** `FORGE_DISABLE_WATCH_ROUTES` (layer 1) — surgical disable of the broken slugs.
2. **If broader:** revert `FORGE_CONTENT_API=strapi` (layer 2) — full revert to Strapi-only.
3. **Do NOT improvise a hybrid mode at incident time.** None exists in the code; reintroducing one requires a re-plan + redeploy and is not faster than layer 3.

A future plan **could** re-introduce `admin-with-fallback` if operationally needed, but it requires a deliberate re-plan, not an incident-time hack.

---

## Monitoring queries

Run these in Vercel/Railway log search (forge-web) and admin's dashboard during the first 30 minutes post-cutover, and as needed during burn-in.

| Query                                          | What it tells you                              | Expected post-cutover                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `event:"forge.parity.admin_null"`              | admin returned `null` for a slug; sanity check | Non-zero is expected for unknown slugs. Investigate spikes against the batch-verification baseline.                                                                                        |
| `event:"forge.parity.admin_timeout"`           | admin timed out on a slug                      | Should be near zero. Non-zero rate signals admin latency regression OR web's `Promise.race` budget is too tight.                                                                           |
| `event:"forge.parity.consumer_bearer_missing"` | web tried to call admin without a bearer       | **Should be ZERO post-cutover.** Non-zero rate signals deploy ordering went wrong (web flipped to admin mode before `WEB_ADMIN_API_KEYS` was set) OR a missing-env regression.             |
| `event:"forge.parity.canary_failed"`           | leftover U5 dual-read canary event             | **Should emit ZERO events post-cutover.** U5's parity-bridge mode guard ensures admin-mode emits no canary events. Non-zero rate signals the guard regressed or U5 deletion is incomplete. |
| Apollo client error rate                       | admin Apollo client error events               | Near zero. Spikes here usually correlate with admin-side incidents — cross-reference admin's dashboard.                                                                                    |
| Slug-page 5xx rate in Railway                  | HTTP 5xx on `/[slug]` route                    | < baseline Strapi-mode 5xx rate. A spike here is the primary trigger for layer 1 / layer 2 rollback.                                                                                       |

If any of the four `forge.parity.*` queries fires a non-zero rate post-cutover, document the event-payload sample in the incident channel before escalating — the payload's `bucket`/`subkind` field tells you which rollback layer is appropriate.

---

## Planned bearer-key rotation (R8a)

**Cadence:** 90-day calendar OR trigger events:

- Team-member offboarding (anyone who had Doppler write access to `WEB_ADMIN_API_KEYS`).
- Security audit finding.
- Suspected exfiltration (escalate to [Emergency bearer-key revocation](#emergency-bearer-key-revocation) instead).

**Routine rotation is ADDITIVE then remove-old.** (Opposite ordering from emergency revocation.) Sequence:

1. **Generate fresh key.** 32+ bytes of entropy, base64-encoded. E.g.:

   ```sh
   openssl rand -base64 32
   ```

2. **Add fresh key to forge-admin Doppler `WEB_ADMIN_API_KEYS` CSV.** Both old and new entries are now valid bearers.

   ```sh
   # Existing CSV: oldKey
   # New CSV: oldKey,newKey
   doppler secrets set --project forge-admin --config prd \
     WEB_ADMIN_API_KEYS=oldKey,newKey
   ```

3. **Deploy admin.** Admin now recognizes both keys.
4. **Update forge-web `WEB_ADMIN_API_KEYS` to the fresh key.**

   ```sh
   doppler secrets set --project forge-web --config prd WEB_ADMIN_API_KEYS=newKey
   ```

5. **Deploy web.** Web now sends `newKey` in its bearer header.
6. **Remove old key from forge-admin CSV.**

   ```sh
   doppler secrets set --project forge-admin --config prd WEB_ADMIN_API_KEYS=newKey
   ```

7. **Deploy admin.** Old key is no longer a valid bearer; rotation complete.

**Source-control prohibition:** the `WEB_ADMIN_API_KEYS` value MUST NEVER appear in committed files, PR descriptions, or CI logs. Admin-side (`consumer-bearer.ts`, `context.ts`, `rate-limit.ts`) and web-side (`admin-client.ts`, Apollo `HttpLink.responseHandler`) structured logging assert this at unit-test time via log-scrub spies. Paste keys into Doppler directly — never via a PR.

---

## Emergency bearer-key revocation

Distinct from planned rotation. Use **only** when `WEB_ADMIN_API_KEYS` is known or strongly suspected to be exfiltrated.

**Order matters: remove the bad key FIRST, then provision a new one.** Adding the new key first leaves the exfiltrated key valid for the duration of the rotation — which is the entire window an attacker needs.

1. **REMOVE the exfiltrated key** from forge-admin Doppler `WEB_ADMIN_API_KEYS` CSV.

   ```sh
   # If CSV was `compromisedKey`, set it to empty (or, if multiple, omit the bad one).
   doppler secrets set --project forge-admin --config prd WEB_ADMIN_API_KEYS=""
   ```

2. **Deploy admin.** Admin no longer recognizes the exfiltrated key.
3. **Accept brief degradation.** Web's runtime safety net (U6) falls back to Strapi semantics for the bearer-missing path; `forge.parity.consumer_bearer_missing` events spike. This is expected and bounded by steps 4-5.
4. **Update web's `WEB_ADMIN_API_KEYS` to a fresh key.** Generate per the [planned rotation](#planned-bearer-key-rotation-r8a) step 1.

   ```sh
   doppler secrets set --project forge-admin --config prd WEB_ADMIN_API_KEYS=newKey
   doppler secrets set --project forge-web --config prd WEB_ADMIN_API_KEYS=newKey
   ```

5. **Deploy admin then web** (receiver-first). `forge.parity.consumer_bearer_missing` returns to zero.

Document the exfiltration vector in a security postmortem before closing the incident.

---

## Unbounded-cycles contingency (R6 + T-7 threshold)

The batch verification harness (U8) is the cutover gate. If batch verification cycles have **not** converged to empty-or-allow-listed by **T-7 days before Strapi's scheduled removal**, escalate to operator with the current diff classes.

Contingencies, in operator-preferred order:

1. **Negotiate Strapi extension** with the team driving Strapi sunset. Buys time to fix the remaining diff classes. First choice — gate convergence is the cleanest outcome.
2. **Extend allow-list aggressively + cut over with documented residual diff.** Each allow-list entry is a documented "we know this differs, we accept it" decision. Use sparingly — every allow-listed diff is a future content-discrepancy bug report.
3. **Defer cutover entirely and re-plan against a longer timeline.** Last resort. Requires explicit operator/PM sign-off; not a developer-side decision.

**Do NOT default to "revert to phased ramp."** The phased-ramp architecture (`admin-with-fallback`, dual-read canary, etc.) is formally superseded by plan-003 and requires re-planning to reintroduce. Treating phased ramp as a casual fallback obscures the architectural decision being unwound.

---

## TODO(U7) — canonical-plan U7 follow-up

The following items are explicitly **out of scope** for this plan and owned by the canonical 7-unit plan's U7 ([`docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md`](../plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md)). Search this file for `TODO(U7)` to find every reference; U7's PR can grep for its work surface here.

- **TODO(U7): R17 no-redeploy rollback mechanism.** Per-slug or per-route feature flag without requiring a redeploy. This plan's `FORGE_DISABLE_WATCH_ROUTES` is process-wide and requires a Railway redeploy on every change; U7 will land a no-redeploy variant (likely backed by an admin-side toggle or edge-config flag).
- **TODO(U7): parity-diff CI gate.** The batch verification harness (U8) runs manually; U7 lands a scheduled CI job that gates `main` merges on parity diff staying empty.
- **TODO(U7): GraphQL Armor cost-limit recalibration.** Admin's `experienceBySlug` cost is currently set conservatively; U7 measures real-world cost and recalibrates.

Distinct from this plan's UB7 (`apps/web/src/app/[slug]/error.tsx` boundary), which is shipped.

---

## Document history

| Date       | Author             | Change                                                                        |
| ---------- | ------------------ | ----------------------------------------------------------------------------- |
| 2026-05-12 | U9 (plan-003 PR-B) | Initial draft — pre-cutover, pre-measurement. Status: `draft until measured`. |
