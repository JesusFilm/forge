---
id: "feat-235"
title: "Chat app Cloudflare DNS cutover (retire Railway domain)"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-08-01"
duration: 2
depends_on:
  - "feat-231"
blocks:
tags:
  - "infrastructure"
  - "web"
---

> The production hostname is decided: **`chat.jesusfilm.ai`**. The
> cutover-mechanics half (below) was captured while fresh from feat-231,
> because the same-`clientId` rule is the detail most likely to be lost and
> most dangerous to get wrong. The Cloudflare/DNS provisioning half is
> dashboard work outside the repo.

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
