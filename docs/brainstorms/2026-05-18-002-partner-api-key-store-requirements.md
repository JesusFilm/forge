---
date: 2026-05-18
topic: partner-api-key-store
---

# Partner API Key Store (DB-backed) for `/api/search`

## Problem Frame

Plan 002 shipped earlier today (2026-05-18) moves admin's `/api/search`

- `Query.search` from public-anyone to bearer-gated, using an env-var
  CSV (`SEARCH_API_KEYS` on `forge-admin` Doppler) for the keyring. The
  pattern matches three sibling internal bearers (`WORKFLOW_API_KEYS`,
  `WEB_ADMIN_API_KEYS`, `BACKUP_DOWNLOAD_API_KEYS`) and was right-sized
  for "no external partner yet — defer the issuance + audit surface."

An external partner now wants to integrate. The CSV approach has
structural weaknesses specific to **external** use that internal M2M
bearers don't have:

- **No per-key audit.** Logs only emit `auth=bearer`, never which key
  matched. Partner A and partner B are indistinguishable in Railway
  logs. Per-partner outage triage is impossible. No usage view to
  hand to a partner who asks "show me my traffic."
- **Plaintext keys in Doppler.** Every operator with `forge-admin`
  Doppler access can read every partner's bearer in cleartext. For
  internal M2M this is acceptable (whoever has Doppler access could
  impersonate the internal service anyway); for partner credentials
  it violates B2B credential-handling norms.
- **Revocation latency.** Edit Doppler → ~3 min Railway redeploy.
  Compare to one `UPDATE` in DB. Friction when responding to a leaked
  key.
- **No per-key metadata.** No owner, no contact, no `created_at`, no
  `last_used_at`, no expiration. Operator runbook is "remember to
  remove the key when the partner offboards."
- **Scaling ceiling.** Doppler CSV + manual editing degrades around
  10-20 keys (operator fatigue + Doppler UI). External partner
  population is potentially unbounded.

Internal bearers don't have these problems and shouldn't be migrated
in v1 — different threat model, different operator pattern, the CSV
is right for them. The work scoped here is **just the partner-facing
surface**.

## Requirements

- **R1.** Admin owns a `PartnerApiKey` table in its own Postgres
  (admin's existing Prisma schema), storing one row per issued
  external-partner key. Row fields cover identity (a stable `keyId`
  embedded in the prefix), the hashed secret, owner metadata
  (display name, contact), lifecycle timestamps (`created_at`,
  `last_used_at`, `revoked_at`), and the issuer (operator email).
- **R2.** Partner keys follow the prefixed format
  `sk_search_<keyId>_<random>`. The `<keyId>` is a short stable
  identifier (≥8 chars, URL-safe) assigned at issuance. The
  `<random>` half is ≥32 bytes of entropy. The full token is what
  the partner presents; the stored hash is `sha256(<full token>)`.
- **R3.** Admin's `isAnyKnownBearer` validator (the OR-composer on
  `apps/admin/src/auth/search-bearer.ts`) gains a new branch that
  parses the prefix, looks up the keyId in `PartnerApiKey`, and
  compares hashes in constant time. The branch runs alongside the
  existing internal-bearer checks (`WEB_ADMIN_API_KEYS`,
  `WORKFLOW_API_KEYS`). A valid partner key passes the search
  passport check; a stale/revoked/expired key does not.
- **R4.** The structured log line for every `/api/search` +
  `Query.search` request emits `keyId` when a partner key matches
  (e.g., `[search] event=search.request auth=bearer keyId=<keyId>
path=rest rl=redis`). For internal-bearer matches and anonymous /
  invalid traffic, `keyId` is omitted. Per-partner traffic is
  greppable in Railway logs from day 1.
- **R5.** Operator surface for issuance + rotation + revocation is a
  CLI:
  - `pnpm --filter @forge/admin partner-keys create --name=... --owner-email=... [--note=...]`
    issues a new key. Prints the plaintext token **once** with a
    "save this now — it will not be retrievable later" banner.
    Stores the hash and metadata.
  - `pnpm --filter @forge/admin partner-keys list` shows all keys
    (id, name, owner, created/last_used/revoked timestamps). Never
    shows hash or plaintext.
  - `pnpm --filter @forge/admin partner-keys revoke <keyId>` sets
    `revoked_at = now()`. Revoked keys fail validation immediately
    on the next request (no admin redeploy required).
  - `pnpm --filter @forge/admin partner-keys rotate <keyId>` is a
    convenience wrapper: issue a new key for the same owner, leave
    the old key live for a configurable grace window, return both
    keyIds. Operator coordinates the partner cutover, then
    `revoke <oldKeyId>`.
- **R6.** Admin dashboard exposes a **read-only** view at
  `/dashboard/partner-keys` listing the same fields as `partner-keys list`
  with sortable columns (last_used_at desc by default). No mutation
  affordances. Access gated by existing admin SSO + ADMIN tier.
  Powers the "who are our partners and when did they last call us?"
  question without needing DB access or a CLI install.
- **R7.** `SEARCH_API_KEYS` (the env-var CSV from Plan 002) is
  removed at v1 ship. The single partner key issued today
  (`xoSP…`) is migrated to a `PartnerApiKey` row before the CSV is
  dropped so the partner experiences no flip. `assertBearerCsvsDisjoint`
  (the boot-time invariant in `apps/admin/src/config/env.ts`) drops
  back to the three internal CSVs. Internal callers
  (apps/web, manager, eval CLI) are unaffected — they continue
  presenting their existing bearers via the existing OR-composition.
- **R8.** `last_used_at` is updated on every successful partner-bearer
  auth, asynchronously (fire-and-forget, no added hot-path latency).
  Drives the dashboard's "has this partner integrated yet?" column.
- **R9.** Soft revocation only — revoked rows stay in the table with
  `revoked_at` set. Preserves audit trail (which key was revoked,
  when, by whom). No hard delete in v1.

## Success Criteria

- **SC1.** A new external partner can be onboarded end-to-end in
  under 5 operator minutes: `partner-keys create` → copy plaintext →
  share via Slack DM → partner integrates → first request lands in
  Railway logs as `keyId=<keyId>`.
- **SC2.** A leaked partner key can be revoked in under 30 seconds:
  `partner-keys revoke <keyId>` → next request from that key returns 401. No admin redeploy involved.
- **SC3.** An operator can answer "which partners called the search
  API in the last week, and how often?" from Railway logs alone
  (grep for `keyId=` over the time window, group by keyId). No DB
  access required.
- **SC4.** An operator can answer "are any partners idle / never
  integrated?" from the `/dashboard/partner-keys` page (sort by
  `last_used_at` ascending; null = never used).
- **SC5.** The partner key issued under Plan 002 today (the
  `xoSP…` CSV value) is migrated to a `PartnerApiKey` row before
  the CSV is dropped, and the partner experiences zero downtime
  during the cutover.

## Scope Boundaries

- **Only `/api/search` + `Query.search`.** Other admin surfaces that
  might become partner-facing in the future (e.g., recommendations,
  experience reads) are out of scope. When/if they ship, decide then
  whether to widen `PartnerApiKey` with a `scopes` column or
  duplicate the pattern. v1 has no scopes column — every row
  implicitly grants "use search."
- **Internal bearers stay on env-var CSV.** `WORKFLOW_API_KEYS`,
  `WEB_ADMIN_API_KEYS`, `BACKUP_DOWNLOAD_API_KEYS` are not migrated.
  Different threat model, different operator pattern, different
  rotation cadence.
- **No per-key rate limits in v1.** Every key (and every anonymous
  caller) stays on the per-IP 30/min Redis bucket from Plan 002.
  Bearer is identity/authorization, not budget. If a single noisy
  partner appears, that's a follow-up with concrete data behind it.
- **No per-key expiration in v1.** No `expires_at` column. Matches
  industry baseline (Stripe keys don't auto-expire). Add later if a
  compliance / rotation policy materializes.
- **No partner self-serve portal in v1.** Issuance is operator-
  mediated (Slack DM handshake). A partner-facing self-serve
  dashboard is a separate, larger product effort.
- **No admin UI for mutations in v1.** Read-only dashboard view per
  R6; all create/revoke/rotate goes through the CLI. Migration to
  full admin-UI CRUD is a future iteration.
- **No webhooks / notifications.** No partner-side notification when
  a key is rotated/revoked. Operator handles via the same Slack DM
  channel used for issuance.
- **No scopes / per-key permission grants.** Every partner key
  grants exactly "use `/api/search` + `Query.search`" — no read/write
  distinction, no per-locale gates, no future-flag scoping. Per-key
  capabilities is a v2 question.

## Key Decisions

- **DB-backed because partners ≠ internal services.** Internal M2M
  bearers can live in env-var CSV because the threat model collapses
  (Doppler-access ≈ impersonation-ability anyway). Partner keys can't
  — they're external credentials with audit, rotation, and revocation
  requirements that the CSV approach has no slot for. The decision is
  about credential class, not key count.
- **Narrowest scope: `/api/search` only.** The shipped `isAnyKnownBearer`
  is already a multi-validator composition (`SEARCH_API_KEYS` ∪
  `WEB_ADMIN_API_KEYS` ∪ `WORKFLOW_API_KEYS`). Adding a fourth branch
  for the DB-backed partner check fits the existing seam. A generic
  multi-surface partner key store with scopes is bigger v1 scope for
  speculative future value; do it when the second partner surface
  actually appears.
- **Prefixed keys (`sk_search_<keyId>_<random>`).** Industry-conventional
  shape (Stripe `sk_*`, GitHub `ghp_*`). The `<keyId>` in the prefix
  means logs carry partner identity for free — no DB lookup needed on
  the log emission path; lookup happens once during auth and the
  `keyId` is already available from prefix parsing.
- **CLI for mutations, dashboard read-only for visibility.** Splits
  scope correctly: the destructive ops (issue/rotate/revoke) belong to
  operators with shell access; the observability question ("who's a
  partner?") deserves a UI but doesn't need write affordances. Saves
  the careful UX work of one-time-plaintext display, confirmation
  modals, etc., for a later iteration.
- **Drop `SEARCH_API_KEYS` at v1 ship.** Cleanest end state, no
  dead-code fallback path that future operators have to remember.
  Cutover risk is real but bounded: there's exactly one CSV key in
  flight (today's `xoSP…`), migrating it to a DB row before the
  drop is one operator step.
- **No `scopes` column in v1, but reserve naming room.** The keyId
  prefix is `sk_search_*`. If a future partner-facing surface needs
  its own key class, the natural extension is `sk_recommendations_*`
  or a `scopes: string[]` column added later — both are forward-
  compatible with the v1 shape.
- **`sha256(token)` for hashing.** Long random tokens don't need
  bcrypt/scrypt's brute-force resistance (the entropy is the
  defense). sha256 is constant-time enough at the comparison layer
  and adds zero hot-path latency.

## Dependencies / Assumptions

- Admin's Postgres + Prisma stack handles the new table without
  migration drama. The repo already has the migration tooling +
  conventions wired up (see `apps/admin/CLAUDE.md` §Migrations).
- The per-request `last_used_at` update is fire-and-forget (no `await`
  in the hot path) so the validator stays sub-millisecond on cache
  hits.
- Operator can fetch the `forge-admin` Postgres DATABASE_URL (already
  in Doppler) for local CLI use against prod. No new credentials
  required.
- The shipped log format from Plan 002 (`[search] event=name
key=value`, plain-string per the Railway logsV2 silencing
  learning) extends cleanly with `keyId=<keyId>`. No log infrastructure
  change.
- WAF passthrough for `Authorization` is already proven (Plan 002
  Unit 5 + the `waf-passthrough-verification-via-prior-art-20260518`
  learning). Format of the bearer doesn't change.

## Outstanding Questions

### Resolve Before Planning

(none — scope is locked.)

### Deferred to Planning

- **[Affects R1][Technical]** Prisma model field names + types (e.g.
  is `keyId` `String @id` or a separate column from the row id?
  `createdBy` an enum vs free-string?). Planning to pick conventions
  consistent with sibling tables.
- **[Affects R1][Technical]** Migration story for the single CSV key
  in flight today. Likely: write the migration, manually insert one
  row matching today's `xoSP…` token (compute its sha256 + assign
  a `keyId`), deploy admin with both the new branch and the CSV
  still active for the duration of one deploy, then drop the CSV in
  the same or follow-up commit. Sequencing is the planning question.
- **[Affects R3][Technical]** In-process cache shape for the auth
  hot path. Likely a small `Map<keyId, PartnerApiKey>` with a 60s
  TTL, invalidated on revoke. Cache miss = DB query (~1ms). Validator
  must remain constant-time at the comparison step.
- **[Affects R4][Technical]** How `keyId` threads from `search-bearer.ts`
  through to the route handler / resolver where the structured log
  is emitted. Likely: validator returns a richer result type
  (`{ valid: true, keyId?: string }` instead of plain boolean) and
  callers tag the log accordingly. Plan 002's `isAnyKnownBearer`
  signature change is the seam.
- **[Affects R6][Technical]** Dashboard route placement
  (`apps/admin/src/app/dashboard/partner-keys/page.tsx`?), data
  loader pattern (server component fetching directly vs an API
  route), and column / sort UX. Should mirror existing dashboard
  routes (workflow-runs, system-status).
- **[Affects R5][Needs research]** Whether the `rotate` command's
  grace-window mechanism is "two live keyIds for the same owner"
  (preferred — uses the existing schema) or something more elaborate.
  Planning should look at how rotation is handled in sibling tools
  (Stripe restricted keys, GitHub fine-grained PATs) before locking
  the UX.
- **[Affects R7][Technical]** Whether dropping `SEARCH_API_KEYS`
  from `assertBearerCsvsDisjoint` requires a code change beyond
  removing the env var + the validator call site, or also affects
  the boot-time invariant test set. Planning to verify.
- **[Affects all][Workflow]** Whether v1 ships as one PR or
  splits (e.g., schema + validator → PR1, CLI → PR2, dashboard view
  → PR3). Planning to size and decide based on review cadence.

## Alternatives Considered

- **Generic multi-surface partner-key store with scopes.** Rejected
  for v1 — speculative complexity. The narrowest path (R1-R9) keeps
  the seam ready to widen if/when a second partner surface ships.
- **Prefixed keys still in env-var CSV (the Plan 002 upgrade path).**
  Rejected — solves audit but keeps plaintext-in-Doppler + manual-
  rotation problems. Only marginally better than today.
- **Full admin-UI CRUD in v1.** Rejected — significantly more scope
  (one-time-plaintext display UX, mutation confirmation flows, scope
  form fields) for marginal operator gain over CLI + read-only dash.
- **JWT-based partner credentials.** Rejected — introduces signing-
  key rotation pain for zero benefit at this scale. Partners do
  server-to-server calls; OAuth/JWT shape is overkill.
- **Hard-delete revocation.** Rejected — destroys audit trail. Soft
  revocation with `revoked_at` is the standard pattern.
- **Migrate internal bearers in the same v1.** Rejected — different
  threat model, no upside on internal-side, dramatically larger
  blast radius. Keep them on CSV.

## Next Steps

→ `/ce:plan` for structured implementation planning.
