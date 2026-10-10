---
id: "feat-093"
title: "Cold Start Context-Based Recommendations"
owner: "nisal"
priority: "P2"
status: "cancelled"
start_date: "2026-06-14"
duration: 7
depends_on:
  - "feat-092"
blocks: []
tags:
  - "web"
  - "personalization"
---

## Closure Decision

Cancelled on 2026-07-21. This cold-start layer depends on the unimplemented and
now-cancelled Two-Tower model in `feat-092`. Anonymous or low-signal fallback
ranking remains a valid product concern, but it should be planned within the
current Watch discovery architecture rather than as an extension of that
historical model.

## Problem

When a user arrives with no session cookie (first visit, cleared cookies, incognito), the Two-Tower user tower has no watch history to work with. Without a cold-start strategy, these users fall back to non-personalized cosine similarity — the same experience as today. Context features available from the request (geo region, device type, browser language, time of day) carry meaningful signal about viewing tendencies that the user tower can exploit.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — serving path where cold-start logic branches
2. The Two-Tower user tower ONNX model (feat-092) — same model, different input: context features only, no watch history embeddings
3. `apps/cms/src/middlewares/rate-limit.ts:resolveClientIp` — pattern for extracting request context (headers, geo)
4. `docs/brainstorms/2026-04-12-user-feedback-driven-recommendations-requirements.md` — R8 (cold start)

## Grep These

- `resolveClientIp\|cf-connecting-ip\|x-forwarded-for` in `apps/cms/src/` — geo/header extraction patterns
- `onnxruntime\|onnx` in `apps/cms/` — model serving path
- `session_id\|sessionId\|jfp_session` in `apps/` — session detection

## What To Build

### Context feature extraction

- Extract from request headers at recommendation time:
  - Geo country/region: `cf-connecting-ip` → Cloudflare geo headers, or IP geolocation fallback
  - Device type: `User-Agent` parsing (mobile/tablet/desktop/tv)
  - Browser language: `Accept-Language` header
  - Time of day: server-local hour bucket (0-5, 6-11, 12-17, 18-23)
- Encode as feature vector matching the user tower's expected input format

### Cold-start inference

- When no session cookie exists (or session has 0 watch events):
  1. Build context-only feature vector (zero-filled watch history, context features populated)
  2. Forward pass through the same Two-Tower user tower ONNX model
  3. Query pgvector with the resulting 256-dim user embedding
- The model learns regional and device-based viewing tendencies during training (feat-092) — cold-start produces a broad, diverse set tuned to the user's context

### Fallback chain

1. Two-Tower with watch history (session has 2+ videos) → personalized
2. Two-Tower with context only (no session / 0-1 videos) → context-personalized
3. Pure cosine similarity (Two-Tower not activated globally) → baseline

## Constraints

- Same ONNX model as feat-092 — do not train a separate cold-start model
- Context features must be extractable without additional network calls (headers only, no external geo API)
- Output should be diverse (not all the same genre) — the model should learn this from training data distribution
- No persistent user profiles — context is per-request, session is per-cookie

## Verification

1. A brand new user (no cookie) in Brazil on mobile sees different recommendations than a new user in Germany on desktop
2. Two cold-start requests with identical context produce identical results (deterministic)
3. Cold-start recommendations include videos from at least 3 different thematic clusters (diversity check)
4. Latency: cold-start path adds <10ms over the baseline recommendation query
5. Once the user watches 2+ videos, recommendations shift from cold-start to session-personalized
