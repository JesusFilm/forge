---
id: "feat-530"
title: "Deliver internal RAG consumer self-service portal"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 5
depends_on: ["feat-526", "feat-527"]
blocks: ["feat-529"]
tags: ["rag", "auth", "observability"]
---

## Problem

Access and reporting need an independently tracked operational proof and usable
internal management path; planning completion does not deliver either.

## Entry Points — Read These First

1. [Plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md).
2. `apps/rag/src/serving/http/portal.ts`, `portal-consumers.ts` and `portal-ui.ts` — portal shell and authenticated management boundary.
3. [UI implementation plan](../../plans/2026-09-28-001-feat-rag-consumer-portal-plan.md).
4. `apps/auth/src/auth/config.ts` — reference only, not proof of deployed GitHub login.

## Grep These

`forge-rag-retrieve`, `TokenRegistry`, `owners`, `FallbackEmbedder`.

## What To Build

Implement the management portion of plan section F immediately after the access
backend. Develop on a local branch against a local database and verify through
the actual UI. Reporting views can follow feat-528; dogfood follows the usable
management flow. GitHub OAuth admits only
signed-in handles in the current merged portal-user allowlist. Show all consumers;
only their runtime owners may manage them. CI validates allowlist handles against
Forge contributor/read-write access as safely verifiable, not consumer memberships.

Create consumer directly: globally unique lowercase letters/numbers/dashes name
(`^[a-z0-9-]+$`), own signed-in GitHub handle read-only as initial owner, then Create directly. The backend creates the record/owner and random secret, displaying
plaintext once with copy/password-manager warning. Never persist or re-reveal it.
Generate new key atomically replaces the verifier and invalidates the old secret.

Only an existing owner can Add member from the predetermined portal-user allowlist.
Added members can manage/regenerate. Preserve at least one owner, audit, revocation
and removal/session semantics. No consumer-registration or owner-change PRs.
As of 2026-09-29, every admitted portal user can view all consumer usage reports
through feat-528’s option A Usage comparison page using the existing GitHub login. Reports require
portal admission, not ownership; management remains owner-only.

V1 has one runtime environment per consumer and no staging environment. The
portal has no environment picker, environment creation or environment-scoped
routes. Generate new key replaces the consumer's single active credential.

## Constraints

No external consumers or implicit quotas. No secrets in logs, tests, command
output, chat, PRs or telemetry. Preserve hashing/HTTPS and no-store secret displays.
Production provisioning/activation requires explicit operator authorization.
Portal admission and production login proof
are already delivered; use the actual feat-527 backend. Development identities
and seed data must remain local, with no production auth bypass or CI fixture setup.

## Verification

Use the local UI to complete deferred feat-527 end-to-end verification.
Run relevant plan E and package checks plus page-load performance. Test allowlist
before/after merge, stale publication and removed-user sessions; all-consumer
visibility with cross-consumer mutation denial; invalid/duplicate/concurrent names;
initial-owner tampering; direct creation; owner-only Add member with allowlist
selection; last-owner protection; concurrent removal/rotation and secret-response
loss. Record synthetic outcomes only. Read package guidance before coding.

## Delivery update — 2026-09-28

Management UI work is in progress in [PR #2442](https://github.com/JesusFilm/forge/pull/2442),
rebased onto main after the feat-527 backend merged. Create consumers through Create in the actual UI
for onboarding evidence. Synthetic HTTP tests remain useful for authorization
and concurrency, but do not replace the user journey. Usage/reporting follows
in feat-528, then feat-529 uses the UI-created RAGBot for actual ops HTTP dogfood.

The first local management slice is implemented: `/portal` provides direct
creation, one-time key display/copy, member selection/removal, replacement keys
and lifecycle controls. [Local UI evidence](evidence/feat-530/local-ui.md) records
browser journeys against real restricted Postgres adapters, an unmodified key
smoke, page-load measurements, checks and remaining live gates. Use
`pnpm --filter @forge/rag portal:dev` per `apps/rag/portal/README.md`.

## UI refinement — 2026-09-28

Use styling cues from `docs/pages/site/index.html` and
`apps/rag/dashboard/template.html`: warm neutrals, JFP red accents, navy controls,
thin dividers and compact table rows. Render one consumer per row with status and
all available actions inline. Preserve that row structure in a horizontally
scrollable table on narrow screens.

Keep the page to its title, controls and consumer rows. Do not add introductory
copy, subtitles, section labels, onboarding guidance or a footer. Add field labels
only when they identify a control, and show validation feedback when needed.
Create uses a single form with name, read-only initial owner, Cancel and Create.
Create immediately issues the key and opens Save your API key. This user decision
supersedes the earlier preview requirement in this ticket and programme plan.

### Typography refinement

The follow-up visual direction retains the minimal copy and table but uses
Forge's Apercu regular/bold fonts, a stronger heading, softer surfaces and status
pills, restrained red brand accents, and lightweight row actions. Remove the red
heading rule; use subtle hover feedback with reduced-motion support. Font files
are served locally from the RAG app. See `evidence/feat-530/typography.md`.

## Registry mockup revision — 2026-09-28

The supplied mockup supersedes the earlier red/neutral treatment and inline
action buttons. Use blue accents, a white table panel, search, All/Active/Revoked
filters, sortable names, real member counts and paginated rows with an action
popover. Navigation contains RAG, Consumers and Knowledge; no Settings item.
RAG and Knowledge are image-only under-construction placeholders using the
user-supplied capybara illustration. The mockup explicitly introduces the
consumer-page subtitle. Retain direct creation and one-time key handling.
See [registry evidence](evidence/feat-530/registry-mockup.md).

## Production activation — 2026-09-28

Setup record: [PR #2445](https://github.com/JesusFilm/forge/pull/2445).

Owner: Jaco. After PR #2442 deployed, sign-in worked but the UI reported
management disabled. Production lacked both consumer database URLs and the
default source policy. Jaco explicitly authorized provisioning and activation
under feat-530. This is operational configuration on the existing Railway
`forge` / `production` / `@forge/rag` service, not a new service or schema feature.

Activation checklist (before feat-528 reporting and feat-529 dogfood):

- [x] Confirm existing production consumer tables and intended database.
- [x] Create `forge_rag_consumer_writer` and `forge_rag_consumer_auth_reader`.
- [x] Store generated credentials in Doppler `forge-rag/prd`; no secret values
      in evidence or repository.
- [x] Run `db:verify-consumer-roles` against both production accounts: passed.
- [x] Jaco approved all 59 currently registered sources as the default scope.
- [x] Stage both Railway consumer database URLs with verified private database
      endpoints and intermediate deployments suppressed.
- [x] Set `RAG_DEFAULT_CONSUMER_SOURCE_KEYS` to those 59 explicit keys.
      Future registry additions require an explicit policy update.
- [x] Railway deployment `39957625-7834-4803-afbc-4ef2493ef68d` succeeded.
- [x] Reload the production portal as `@jaco-brink`: consumer directory loads,
      Create consumer is available, disabled notice is absent, and registry is empty.
- [x] Owner subsequently confirmed creation of `ragbot` and `website-factory`
      through the production portal UI and saved their issued keys in Bitwarden.
      See the [closure record](evidence/feat-529/owner-acceptance.md).

See `apps/rag/docs/ops/consumer-access-migration.md` for exact privileges and
secret names. Activation does not start feat-529's seven-day grace or change
legacy credentials. Keep feat-530 in progress until its remaining UI/live gates
are observed.

## Resolution — 2026-09-30

Closure PR: [#2513](https://github.com/JesusFilm/forge/pull/2513).

This owner acceptance supersedes the earlier forward-looking closure gates in
this ticket.

The management UI shipped in [PR #2442](https://github.com/JesusFilm/forge/pull/2442)
and was activated in production under the recorded operator authorization.
The owner confirmed production creation of two consumers through that UI,
credential custody in Bitwarden, report detail and access-boundary checks.
The earlier local UI, authorization, concurrency and page-load checks remain
recorded in [local evidence](evidence/feat-530/local-ui.md). The owner accepted
the remaining live failure-injection and session checks as unverified; see the
[closure record](evidence/feat-529/owner-acceptance.md). No production change is
made by this documentation closure.
