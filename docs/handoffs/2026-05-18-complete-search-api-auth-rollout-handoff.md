# Complete `/api/search` bearer-auth rollout — handoff

**Date:** 2026-05-18 · **Author:** Nisal (via Claude Opus 4.7) · **Status:** Phase 1 shipped; Phase 2–4 pending operator action; observation window now open

## Status snapshot — what landed in the prior arc

Plan 002 Phase 1 (dual-accept bearer auth on `/api/search` + `Query.search`) is **live in production**. Empirically validated 2026-05-18: probes against `admin.jesusfilm.org` produced visible `[search] event=search.request auth=invalid_bearer path=rest rl=redis` lines in Railway logs, confirming:

- Bearer-key validator (`isAnyKnownBearer`) is running.
- The 3-state auth tagging works (`bearer` / `invalid_bearer` / `anonymous`).
- Rate-limit-before-auth ordering is active (`rl=redis` tag).
- Cloudflare WAF passes `Authorization` through (otherwise `invalid_bearer` would show as `anonymous`).
- Both REST and GraphQL surfaces emit the structured log.

### PRs in the arc

| PR       | Commit     | Status                           | Purpose                                                                                                                                                                                                                                |
| -------- | ---------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#968** | `a88d269c` | ✅ Merged                        | Plan 002 Phase 1 admin code (bearer-as-passport multi-CSV composition; rate-limit-before-auth; 3-state log; disjointness invariant extended to 4 CSVs; eval harness `SEARCH_API_KEY` plumbing; full test suite)                        |
| **#970** | `c92e7a8a` | ✅ Merged but **verified wrong** | First observability-fix attempt: `console.log` → `console.warn`. Hypothesis "stdout silenced, stderr surfaces" was incomplete.                                                                                                         |
| **#971** | `69126099` | ✅ Merged                        | Three solution docs archiving learnings: bearer-as-passport pattern, WAF-via-prior-art shortcut, Railway logsV2 silencing (initial diagnosis — corrected later)                                                                        |
| **#972** | `7bb36221` | ✅ Merged but **verified wrong** | Second observability-fix attempt: `console.warn` → `console.error`. Hypothesis "only console.error surfaces" was wrong — JSON payload was the actual blocker.                                                                          |
| **#973** | `8678606b` | ✅ Merged + **verified working** | Third (correct) observability fix: `JSON.stringify(...)` → `` `[search] event=name key=value` `` plain-string format. Matches the convention of the working `event=query_embedding_failure` log. Probe-confirmed 2026-05-18 04:00 UTC. |

### Solution docs produced

- [`docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`](../solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md) — the OR-composition pattern + disjointness invariant + rate-limit-before-auth + receiver-first deploy ordering.
- [`docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md`](../solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md) — the empirical "is something with the same shape already working in prod?" shortcut.
- [`docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`](../solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md) — the JSON-payload silencing bug + diagnostic journey through 3 fix attempts + the working format. **Read this before adding any new structured per-request logs in admin.**

### Origin docs (still authoritative for design intent)

- [`docs/brainstorms/2026-05-17-search-api-auth-requirements.md`](../brainstorms/2026-05-17-search-api-auth-requirements.md) — requirements (R1-R8, scope boundaries, key decisions)
- [`docs/plans/2026-05-17-002-feat-search-api-auth-plan.md`](../plans/2026-05-17-002-feat-search-api-auth-plan.md) — 9-unit implementation plan + phased delivery
- [`docs/handoffs/2026-05-17-add-search-api-auth-handoff.md`](./2026-05-17-add-search-api-auth-handoff.md) — original kickoff doc (now superseded by this handoff for the rollout phase)

---

## Pending work — full landscape

### Plan 002 rollout (continuing)

| Phase                                                                                          | Status                     | Blocker / Trigger                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 2: Doppler `SEARCH_API_KEYS` provisioning**                                            | Not started                | Only required when an external partner needs onboarding. Internal apps work as-is via consumer-bearer / workflow-bearer.                                   |
| **Phase 3: Eval harness `SEARCH_API_KEY` env on operator workstations + Railway eval service** | Not started; small         | Code plumbing is already in PR #968. Just need a key value set in env. Required BEFORE Phase 4 flip (eval-search.ts harness will start 401-ing otherwise). |
| **Phase 4: Flip `SEARCH_AUTH_REQUIRED=true`**                                                  | Gated on 3-day observation | Must confirm zero `auth=anonymous` requests from known-internal IPs over the observation window.                                                           |

### Cleanup / debt

| Item                                                                                                      | Severity                   | Notes                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`apps/admin/src/services/revalidate-webhook.ts:126-128`** still uses `console.log(JSON.stringify(...))` | Low                        | Fires only on Experience publish (low volume), so the silencing hasn't been operator-noticed. Migrate to the `[label] event=name key=value` format from the docs/solutions/ entry next time the file is touched.                                                                                            |
| **Pino structured-logger migration**                                                                      | Low (proper long-term fix) | Would replace the per-call-site `[label] event=...` template strings with a typed logger interface. Severity goes in the payload, not the wire-channel. Eliminates the semantic mismatch (search.request tagged as `error` in Railway). Probably a multi-day effort spanning admin and possibly other apps. |

### Out-of-arc but adjacent

- **No partner key has actually been issued yet.** When the first external partner shows up, Phase 2 + key sharing happens.
- **apps/mobile still hits Strapi, not admin.** When mobile eventually migrates to admin (future R-phase), the bundled-key extraction threat the brainstorm doc flagged becomes relevant. Plan 002's design accepts this as a known limit; the brainstorm's "Outstanding Questions > Deferred to Planning" Q5 (audit / per-key revocation upgrade path) becomes load-bearing at that point.

---

## Recommended next block: Phase 4 flip (with Phase 3 prep)

This is the natural conclusion of Plan 002. Phases 3 and 4 together close the design loop.

### Preconditions (verify before starting)

1. **Observation window has elapsed** — at least 72 hours since 2026-05-18 ~04:00 UTC (PR #973 deploy time). So earliest start: **2026-05-21 04:00 UTC**.
2. **No internal callers logging as `auth=anonymous`** during the window. Grep Railway logs:
   ```bash
   railway logs --service admin | grep "event=search.request" | grep "auth=anonymous"
   ```
   Inspect source IPs / User-Agents of every match. Anything from Railway-internal egress, our office, or known partner IPs is a problem — fix BEFORE flipping.
3. **Phase 3 done first** — set `SEARCH_API_KEY` on (a) operator local `.env` files for the eval harness, (b) any Railway service that runs the eval CLI scheduled. Otherwise eval-search.ts will start 401-ing after the flip.

### Phase 3 runbook (small — ~15 min)

1. Generate a fresh opaque key for the eval harness:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. Add the generated value to **two** places:
   - On the `forge-admin` Doppler project: append the value to `SEARCH_API_KEYS` (CSV). This is the receiver-side allowlist.
   - On operator workstations (local `.env`): set `SEARCH_API_KEY=<same-value>`. This is the caller-side single key the eval CLI reads at `apps/admin/src/scripts/eval-search.ts`.
3. Deploy admin (Doppler change → Railway redeploys). **Receiver-first deploy ordering** per `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.
4. Verify: run `pnpm --filter @forge/admin eval:search:calibrate` from an operator workstation. Should succeed with HTTP 200s. Tail Railway logs — should show `event=search.request auth=bearer` for the calibration probes.
5. If admin runs scheduled eval-search jobs on a Railway service (check `forge` Railway project for any eval-related service), set `SEARCH_API_KEY` there too.

### Phase 4 runbook (one Doppler change + observation)

1. **Pre-flip log audit (15 min):**

   ```bash
   railway logs --service admin --since 24h \
     | grep "event=search.request" \
     | awk '{for(i=1;i<=NF;i++) if($i ~ /^auth=/) print $i}' \
     | sort | uniq -c
   ```

   Expect a mix:
   - Lots of `auth=bearer` (apps/web SSR, workflow-trigger callers)
   - Some `auth=anonymous` (external scrapers, partners not yet onboarded)
   - Maybe a few `auth=invalid_bearer` (stragglers with stale keys)

   For each `auth=anonymous` line, look up source IP via Railway log details. Anything from `*.railway.internal`, `*.jesusfilm.org`, or known partner IPs → STOP and fix before flipping.

2. **Flip the flag:**

   ```
   Doppler project: forge-admin
   Add/update env var: SEARCH_AUTH_REQUIRED=true
   ```

   This triggers a Railway redeploy (~10 min build + deploy).

3. **Post-flip monitoring (1 hour active + 24h passive):**
   - Within 5 min of deploy: spike on `auth=invalid_bearer` and `auth=anonymous` requests should now show as 401 in admin's HTTP logs. Expected.
   - **Failure signal:** spike on 401s from known-internal IPs (apps/web, manager, eval) → roll back immediately:
     ```
     Doppler: SEARCH_AUTH_REQUIRED=false → redeploy admin
     ```
   - Watch the 5xx rate on `/api/search` and `Query.search`. Should not change (auth check is a fast path before any service call).

4. **Update kickoff handoff status:**
   - Edit [`2026-05-17-add-search-api-auth-handoff.md`](./2026-05-17-add-search-api-auth-handoff.md) Status to "shipped — required-auth live as of YYYY-MM-DD".
   - Append a row to the Status update table in that handoff documenting the flip.

5. **Update memory:**
   - The brainstorm doc's R3 ("`SEARCH_AUTH_REQUIRED` defaults to `false`") becomes outdated. Note in the project memory file ([`feedback_bearer_as_passport_composition`](/home/vscode/.claude/projects/-workspace/memory/feedback_bearer_as_passport_composition.md)) that the flip has happened and what date.

### Open questions for the next block

- **Should Phase 4 happen on a Friday or mid-week?** Trade-off: mid-week gives faster response if something breaks; Friday gives the weekend for traffic to settle before review. The brainstorm doc didn't pick. Recommend: **mid-week early morning** (Tuesday/Wednesday UTC) so the admin team has the full week to respond if anything breaks.
- **Should we provision SEARCH_API_KEYS with the eval harness key now, or wait until Phase 3 is run?** Provisioning now is harmless — internal traffic will still use consumer-bearer for graphql + workflow-bearer for triggers; the eval key is the only consumer that uses SEARCH_API_KEYS directly. Recommend: **do it together with Phase 3 to minimize Doppler churn**.
- **Do we want partner-portal onboarding before flipping required-auth?** Per brainstorm Q4: not in v1. Slack-DM handshake suffices. Recommend: **defer; existing approach is fine until an external partner actually appears**.

---

## Notes / accumulated context

### Things to know before touching this surface

- **The auth check accepts ANY known-caller bearer**, not just `SEARCH_API_KEYS`. The OR-composition lives at `apps/admin/src/auth/search-bearer.ts` (`isAnyKnownBearer`). When the next maintainer asks "why does apps/web work without a SEARCH_API_KEY?" — it's because web's `WEB_ADMIN_API_KEYS` (consumer-bearer) is one of the three accepted CSVs. See the bearer-as-passport learning doc.

- **The disjointness invariant fires at boot** if an operator pastes the same value into two CSVs simultaneously. The fail-fast error names all overlapping pairs in one message (per PR #972 P3 fix). Recovery: remove the duplicate from whichever CSV is wrong, then redeploy. Per-key audit / revocation is deferred follow-up work.

- **Rate-limit fires BEFORE auth.** Every request (anonymous, valid bearer, invalid bearer) drains the per-IP 30/min bucket. An attacker spamming junk bearers gets 429'd just like any other caller. Don't reorder.

- **Use the `[label] event=name key=value` log format**, NEVER `console.error(JSON.stringify(...))`. The JSON-payload silencing in Railway logsV2 was diagnosed via three failed PRs (#970, #972, then #973 which got it right). See the runtime-errors learning doc. Affected code paths: any `apps/admin/src/app/api/**/route.ts` or `apps/admin/src/graphql/queries/**.ts` that emits structured per-request logs.

### Things that are deliberately NOT in this design

- **No per-key rate-limit buckets.** Per brainstorm R5 — bearer is a passport, not a budget.
- **No JWT, no short-lived tokens, no per-device exchange.** Opaque CSV bearers.
- **No admin UI for key issuance.** Slack-DM + Doppler-paste in v1.
- **No per-key audit log.** Logs say `auth=bearer` but not which key matched. Upgrade path (prefixed tokens like `sk_search_<keyId>_<random>`) documented in `search-bearer.ts` for when this becomes load-bearing.
- **No backup-download bearer accepted as search passport.** `BACKUP_DOWNLOAD_API_KEYS` is excluded from `isAnyKnownBearer` by design. Asserted by test.

### When this design will need to change

- **Mobile migrates to admin.** Bundled-key extraction becomes a real threat. Brainstorm Q5 (audit + revocation upgrade) becomes load-bearing then.
- **Search endpoint starts returning sensitive data.** Today it's public read-only video/experience metadata. If PII or paid content ever lands behind this endpoint, the shared-secret model becomes inadequate — move to short-lived tokens or scoped JWTs.
- **External partner count exceeds ~10.** Manually rotating a CSV across many partners gets operationally painful. At that point: partner portal + self-service key issuance.

---

## Suggested next session entry point

Run `/ce:work` against this handoff (or pick the recommended block manually). The order of operations is:

1. **Verify observation window has passed** (≥72h since 2026-05-18 04:00 UTC = earliest 2026-05-21 04:00 UTC).
2. **Run the pre-flip log audit** to confirm no internal callers are still anonymous.
3. **Phase 3 first** — provision eval harness key.
4. **Phase 4 flip** — set `SEARCH_AUTH_REQUIRED=true` on Doppler.
5. **Monitor post-flip** for 1 hour active, 24h passive.
6. **Update this handoff + brainstorm + memory** with the completion date.

If the log audit surfaces internal callers stuck on `auth=anonymous` — pause Phase 4, identify the caller, get them onto a bearer, observe again.

If everything is clean, the flip is a single Doppler env var change.

---

## Notes from operator

(operator additions here)
