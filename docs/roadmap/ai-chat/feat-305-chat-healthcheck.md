---
id: "feat-305"
title: "Railway healthcheck for the chat service"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-304"
blocks:
  - "feat-306"
tags:
  - "web"
  - "infrastructure"
---

## Problem

`apps/chat` is one of only two Railway services in this monorepo with **no**
healthcheck — and the other one (`apps/roadmap`) is an internal dashboard.
Chat is a public, Cloudflare-fronted production surface at `chat.jesusfilm.ai`.

| Has a healthcheck                                                                                      | None              |
| ------------------------------------------------------------------------------------------------------ | ----------------- |
| admin, auth, manager, mastra, mastra-gateway, web, crop-worker, shorts-worker, yt-video-mapper-backend | **chat**, roadmap |

Consequence today: **any** startup-time failure in chat promotes and serves
errors to users with no automatic rollback. `restartPolicyType = "on_failure"`
in `apps/chat/railway.toml` does not cover it — that only fires if the process
_exits_. A Next server that boots successfully and then fails every request
(a rejected `prepare()`, a module-init error, a bad env read at first use) looks
perfectly healthy to Railway and gets promoted over the working deployment.

This was surfaced by feat-304, which had to design _around_ the missing
healthcheck: the Seeker egress diagnostic reports a misconfiguration instead of
throwing, precisely because a throwing `register()` rejects Next's `prepare()`
for every request and nothing would roll that back. That workaround is
reasonable while no healthcheck exists — but the missing healthcheck is the
actual bug, and this ticket fixes it. feat-306 then upgrades the diagnostic.

## Entry Points — Read These First

1. `apps/auth/src/app/api/health/route.ts` — the house pattern with a little
   service metadata (`ok`, `service`, and a config-derived value).
2. `apps/admin/src/app/api/health/route.ts` — the minimal variant
   (`Response.json({ status: "ok" })`). Either shape is acceptable; prefer the
   auth shape if a cheap, non-secret config echo aids debugging.
3. `apps/chat/railway.toml` — where `healthcheckPath` / `healthcheckTimeout` go.
   Note the file's own header: Railway reads it only when the service's
   Config-as-code Path points at it. **That path is confirmed configured for
   chat**, so entries in this file do take effect.
4. `apps/chat/src/app/api/seeker/route.ts` — read the top of any existing chat
   route for the `force-dynamic` convention before writing the new one.
5. `apps/chat/src/instrumentation.ts` and the "Production egress pin" section of
   `apps/chat/CLAUDE.md` — **both currently justify report-only behavior by
   asserting chat has no healthcheck.** Landing this ticket makes those
   statements false; updating them is in scope here (see What To Build).

## Grep These

```bash
# Sibling healthcheck config, for timeout values and path conventions
grep -rn "healthcheck" apps/*/railway.toml

# Every place the "no healthcheck" justification is written down — all of these
# go stale the moment this ticket lands
grep -rn "healthcheck" apps/chat/ docs/roadmap/ai-chat/feat-304-*.md

# Existing health route implementations
find apps/*/src/app/api/health -name route.ts
```

## What To Build

**1. `apps/chat/src/app/api/health/route.ts`.** A GET returning 200 JSON. Keep it
**shallow and dependency-free** — no Mastra reachability probe, no session
decode, no env assertions beyond what is already parsed at module load. A
healthcheck that depends on a downstream service converts an upstream outage
into a chat rollback, which is worse than the problem being solved. Mark it
`export const dynamic = "force-dynamic"` so it is never statically cached.

**2. `apps/chat/railway.toml`** — add to the existing `[deploy]` block:

```toml
healthcheckPath = "/api/health"
healthcheckTimeout = 60
```

60s matches admin, auth, manager, mastra, and web. Do not copy
mastra-gateway's 300 or shorts-worker's 120 — those cover heavy model/bundle
warmup chat does not have.

**3. Update the two now-false justifications.** Both were written when no
healthcheck existed:

- `apps/chat/src/instrumentation.ts` — the header comment states a throw would
  reject `prepare()` "and chat's railway.toml has no healthcheck to roll that
  back." Replace the second clause: a healthcheck now exists, so the throw
  upgrade is viable and is tracked as feat-306. **Do not change the hook's
  behavior in this ticket** — it stays report-only until feat-306.
- `apps/chat/CLAUDE.md`, "Production egress pin" — same correction.

**4. Do not change `restartPolicyType`.** It is complementary, not redundant:
it covers process exit, the healthcheck covers boot-but-broken.

## Constraints

- **Shallow check only.** No Mastra call, no Postgres call, no bearer use, no
  gate resolution. This endpoint must succeed whenever the process can serve
  HTTP, and fail only when it genuinely cannot.
- **No auth on the route, and no secrets in the body.** Railway's prober is
  unauthenticated. Echoing a base URL is acceptable; echoing any key, bearer,
  allowlist, or session material is not.
- **Do not flip `register()` to throw here.** That is feat-306 and it must not
  land until this healthcheck is observed working against a real deploy.
- Scope is chat only. Do not add a healthcheck to `apps/roadmap` in this ticket
  — that is a separate call about an internal dashboard.

## Verification

```bash
pnpm --filter @forge/chat test
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat build

# Local: the route answers 200 without any Seeker/Mastra env set at all
pnpm --filter @forge/chat start &
curl -si localhost:3200/api/health | head -1        # expect: HTTP/1.1 200 OK
```

Add a colocated `route.test.ts` asserting 200, the JSON shape, and — the one
that matters — that it still returns 200 with **no** Seeker env configured
(the default-off boot). A healthcheck that fails on an unconfigured-but-healthy
chat would block every deploy of the default-off posture.

**Post-merge, before feat-306 may start:** watch one real Railway deploy and
confirm the healthcheck actually ran and gated promotion — the deploy log should
show the healthcheck attempt against `/api/health`. Record that observation in
the PR or the ticket Resolution. feat-306's entire safety argument rests on this
being genuinely active, so an assumption is not good enough; a throwing
`register()` behind an inert healthcheck is the unrecoverable outage feat-304
deliberately avoided.
