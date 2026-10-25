# Residual Review Findings — Daily Devotional Generator

Branch: `feat/daily-devotional-generator`
Source: `ce-code-review` (7-persona panel) over the daily-devotional feature.
Plan: `docs/plans/2026-06-17-002-feat-daily-devotional-generator-plan.md`

All **P1/P2 actionable findings in the new code were fixed** in commit
`fix(review): apply autofix feedback` (idempotency rework, news-URL validation,
safety-gate fencing, type-drift, low-confidence reason ordering, plus direct
`llm.ts` tests and workflow edge-case tests). 526 tests pass; typecheck + lint clean.

The items below were **deliberately deferred** — they need cross-team input, a
new env var/contract, or are inherent risk to monitor rather than fix in code.

## Deferred — follow-up work

- **Concurrent same-date double-publish (P2, reliability/adversarial).** Two
  overlapping runs for the same date (cron retry racing a manual replay) can both
  read "not found" and both publish. No in-process/file lock. Mitigated today by
  the watch-site ingest deduping by date (assumption A7). Robust fix: a per-date
  claim marker (atomic `writeFile` with `wx`) before generation, mirroring the
  manager backfill claim-lock pattern.

- **Publish-then-artifact ordering (P1→residual, reliability R-01).** If the
  artifact write fails _after_ a successful publish, the run returns
  `artifact_failed` (retryable); a cron retry re-publishes (again relying on
  site-side date dedupe). Robust fix: two-phase write — persist `published:false`
  before publish, then update to `published:true` after. Deferred to keep the
  single-write path simple until the site ingest contract is finalized.

- **`site-publish-client` empty-object 2xx defaults to `published:true` (P3).**
  A `200 {}` response (neither `published` nor `accepted`) is treated as
  published and locks the date idempotency. Decide with the web team whether the
  ingest endpoint always returns an explicit flag; if so, treat its absence as
  `invalid_response` instead of defaulting to `true`.

- **`DEVOTIONAL_SITE_INGEST_URL` lacks the prod HTTPS + host-allowlist assertion
  (security P3).** Every other egress target (Firecrawl, AI Gateway, API.Bible)
  asserts https + an allowlisted host before sending a bearer. Add
  `DEVOTIONAL_SITE_INGEST_ALLOWED_HOSTS` + a boot-time assertion so a misconfigured
  `http://` ingest URL fails fast instead of leaking the bearer in plaintext.

- **UTC date default (P3).** `dateFromInput` defaults to the UTC date. The
  external cron should pass an explicit `date` (it does, by design — A6); if the
  default is ever relied on, derive from a configured timezone or document the
  UTC contract.

- **Roadmap ticket (project-standards P2).** No `feat-NNN` roadmap ticket was
  created / set `in-progress`. This is a Gospel Media Lab experiment; lane/owner
  assignment is a judgment call left to the owner.

## Monitor — inherent risk

- **Prompt-injection into auto-published text (security/adversarial residual).**
  News + partner content fetched via Firecrawl flows into the writer prompt and
  is auto-published after only the LLM safety gate. Mitigations in place: gate
  fails closed, blocks on low confidence, judged content is now fenced as
  untrusted, and the news `sourceUrl` is allowlisted to real candidates. Residual:
  a subtle injection the judge scores ≥0.6 on all dimensions still publishes.
  Recommended ops mitigation: set a **stronger, independent `DEVOTIONAL_SAFETY_MODEL`**
  in production (it defaults to the same model as the writer, which weakens
  judge independence), and monitor the score distribution of published vs blocked.
