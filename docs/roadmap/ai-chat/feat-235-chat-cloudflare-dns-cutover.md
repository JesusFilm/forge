---
id: "feat-235"
title: "Chat app Cloudflare DNS cutover (retire Railway domain)"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-08-01"
duration: 2
depends_on:
  - "feat-231"
blocks:
tags:
  - "infrastructure"
  - "web"
---

## Resolution

**Shipped:** 2026-07-06 via [PR #1475](https://github.com/JesusFilm/forge/pull/1475)
(`feat(ai-chat): cut chat prod OAuth client over to chat.jesusfilm.ai (feat-235)`).

**What landed.** Two deviations from the brief: the hostname is
`chat.jesusfilm.ai` (the brief's example guessed `chat.jesusfilm.org`), and the
Cloudflare provisioning half (DNS, WAF, Authenticated Origin Pulls, DNSSEC) was
already in place before the PR — so the repo change reduced to the safe-path
seed repoint: `jfp_chat_production`'s redirect/origin/post-logout URIs moved to
the new origin under the **same `clientId`**, plus chat deployment docs trimmed
to end-state. Cutover completed 2026-07-07: re-seed receipt confirmed on the
post-merge auth deploy, `CHAT_BASE_URL=https://chat.jesusfilm.ai` set on chat's
Railway service, owner verified sign-in end-to-end on the new hostname and that
the old Railway host no longer completes anything — closing both the
Cloudflare-bypass origin and the reclaimable-redirect exposure feat-231
accepted as time-boxed. One ordering deviation: the Railway public domain was
released during the out-of-band Cloudflare setup, before the seed scrub — a
~1–2h dangling-redirect window, assessed no-impact (host never claimed;
identity-only scopes bounded the worst case).

**Compound docs.** None created — the cutover executed the existing
`docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md`
(Check 2, "Host change / DNS cutover — the safe path").

**Residual risk / follow-ups.** `SEEKER_CHAT_ENABLED` stays off; flipping it on
still requires the feat-233 dogfood gate + inbound-auth/rate-cap prerequisites
first — the friendlier hostname only widens discoverability. With no
reclaimable host left in chat's seed, feat-231's domain-lifecycle residual is
closed.

## Problem

The deployed chat app runs on its raw Railway-generated domain
(`forgechat-production-a4f5.up.railway.app`) with no WAF, no rate limiting, and
no DNS indirection in front of it, and feat-231 registered the production OAuth
client (`jfp_chat_production`) with its redirect/origin URIs pinned to that host
(`apps/chat/CLAUDE.md` → Deployment: "no `jesusfilm.org` DNS until Cloudflare
fronting lands"). Cut over to a Cloudflare-fronted `jesusfilm.org` hostname to
gain edge protection and to remove the reclaimable-raw-host exposure that the
seed/domain lifecycle currently carries.

## Entry Points — Read These First

1. `docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md`
   — **read first.** The exposure/lifecycle framework and the exact cutover
   mechanics (Check 2: "Host change / DNS cutover — the safe path" vs the
   drop/rename-`clientId` trap) live here.
2. `apps/auth/src/domain/apps.ts` — `CHAT_APP_SEED` production environment (the
   `jfp_chat_production` redirect/origin/post-logout URIs to repoint).
3. `apps/chat/CLAUDE.md` → Deployment — current Railway-domain status.
4. Root `CLAUDE.md` "Known Patterns": Cloudflare + Railway requires
   Authenticated Origin Pulls + DNSSEC (the provisioning pattern to mirror).

## What To Do

1. Provision the chat hostname — decided: `chat.jesusfilm.ai` — with
   Cloudflare fronting: DNS, WAF, Authenticated Origin Pulls, DNSSEC,
   mirroring the platform Cloudflare + Railway pattern. (Dashboard work,
   outside the repo.)
2. **DNS cutover — KEEP the same `clientId` (`jfp_chat_production`); change only
   the URLs.** Repoint `redirectUris` / `postLogoutRedirectUris` /
   `allowedOrigins` in the production environment from the Railway host to the
   Cloudflare host. The seeder upserts by `clientId` and its `update` branch
   replaces those arrays wholesale, so the old Railway URL is scrubbed from
   auth's DB on the next auth deploy. **Do NOT mint a new `clientId` for the new
   host and drop the old one** — the seeder is upsert-only and never prunes, so
   that orphans the old client row with its reclaimable redirect fully live.
3. Update chat's Railway env: `CHAT_BASE_URL` → the new origin;
   `AUTH_CHAT_CLIENT_ID` stays `jfp_chat_production`; no client secret.
4. **Ordering:** merge the seed URL change and confirm the auth deploy re-seeded
   (deploy-log receipt) BEFORE releasing/retiring the Railway public domain on
   Railway. The scrub only lands when the seed reruns; releasing the domain
   first opens the dangling-redirect window.
5. If `SEEKER_CHAT_ENABLED` is to be turned on as part of going live, land the
   inbound-auth + rate/concurrency-cap prerequisites first (per
   `apps/chat/CLAUDE.md` accepted-risk notes).

## Constraints

- Same `clientId` throughout — never a fresh one for the cutover.
- Identity-only scopes stay unchanged (`openid` / `profile:read` / `email:read`).
- Retire the Railway public domain only AFTER the re-seed is confirmed.

## Verification

- Auth deploy log shows the re-seed; `jfp_chat_production`'s redirect is now the
  Cloudflare host and the Railway host is gone from the row.
- Sign-in works end-to-end on the new hostname; the old Railway host no longer
  completes a sign-in (redirect_uri mismatch).
- The Railway public domain is retired on Railway.
