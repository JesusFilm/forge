---
id: "feat-090"
title: "Watch Event Collection & Session Tracking"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: "2026-04-30"
duration: 10
depends_on:
  - "feat-046"
blocks:
  - "feat-091"
  - "feat-092"
tags:
  - "cms"
  - "web"
  - "infrastructure"
  - "personalization"
---

## Closure Decision

Cancelled on 2026-07-21. `feat-229` delivered the current authenticated Web
watch-event foundation in Admin, superseding this ticket's anonymous
`jfp_session` and legacy CMS storage design. Future personalization work should
build on the durable `WatchEvent` and `WatchProgress` models rather than create
a parallel anonymous event stream.

## Problem

The recommendation system returns identical results for every user watching the same video — pure cosine similarity with no learning from behavior. Before any personalization model can be trained (FPMC for "watch next", Two-Tower for home page), interaction data must be collected. No watch event infrastructure exists today.

Related signed-in progress brainstorm: `docs/brainstorms/2026-07-02-watch-signed-in-playback-progress-requirements.md`.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — current recommendation query that will eventually consume personalization signals
2. `apps/cms/src/bootstrap/ensure-pgvector.ts` — pattern for bootstrap SQL table creation (same approach for `watch_events`)
3. `apps/web/src/app/layout.tsx` — root layout where session cookie middleware would be wired
4. `apps/web/src/components/VideoPlayer.tsx` or equivalent — video player component where watch events are emitted
5. `docs/brainstorms/2026-04-12-user-feedback-driven-recommendations-requirements.md` — full requirements (R1-R3)

## Grep These

- `recommender` in `apps/cms/src/` — current recommendation path
- `cookie` in `apps/web/src/` — any existing cookie patterns
- `video.*player\|VideoPlayer` in `apps/web/src/` — video playback components
- `ensure.*table\|CREATE TABLE` in `apps/cms/src/bootstrap/` — table creation pattern

## What To Build

### watch_events table (CMS PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS watch_events (
  id              SERIAL PRIMARY KEY,
  session_id      UUID NOT NULL,
  video_id        INTEGER NOT NULL,
  watch_duration  FLOAT NOT NULL,
  video_duration  FLOAT NOT NULL,
  completion      FLOAT GENERATED ALWAYS AS (
    CASE WHEN video_duration > 0 THEN watch_duration / video_duration ELSE 0 END
  ) STORED,
  is_bounce       BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN video_duration > 0 THEN (watch_duration / video_duration) < 0.3 ELSE TRUE END
  ) STORED,
  geo_country     TEXT,
  geo_region      TEXT,
  device_type     TEXT,
  browser_lang    TEXT,
  referrer_type   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS watch_events_session_id ON watch_events(session_id);
CREATE INDEX IF NOT EXISTS watch_events_video_id ON watch_events(video_id);
CREATE INDEX IF NOT EXISTS watch_events_created_at ON watch_events(created_at);
CREATE INDEX IF NOT EXISTS watch_events_not_bounce
  ON watch_events(video_id, session_id) WHERE NOT is_bounce;
```

### Session cookie (apps/web)

- First-party UUID cookie set on first visit, persists across visits
- `HttpOnly: false` (needs JS read for event emission), `SameSite: Lax`, `Secure: true`
- Cookie name: `jfp_session`
- Generate UUID client-side on first visit, store in cookie with 1-year expiry

### Event emission (apps/web)

- Emit watch events from the video player on: (a) video pause, (b) video end, (c) tab/page unload (`visibilitychange` or `beforeunload`)
- POST to `POST /api/watch-events` with `{ sessionId, videoId, watchDuration, videoDuration }`
- Use `navigator.sendBeacon` for unload events to avoid lost data
- Debounce: don't emit more than once per 5 seconds for the same video

### Watch event API (CMS)

- `POST /api/watch-events` — accepts event payload, extracts geo/device/language from request headers
- `auth: false` (public, matches search endpoint pattern)
- Rate limited: 60/min per session ID
- Validate: `videoId` exists, `watchDuration >= 0`, `videoDuration > 0`

## Constraints

- No login system. All identity is session/cookie-based.
- No PII stored — session_id is a random UUID, not tied to any user account.
- GDPR: cookie is functional (enables personalized recommendations), not tracking. May need consent banner for EU — defer legal review to implementation.
- Do not modify the existing recommendation query in this ticket. Data collection only.
- Web app first. Mobile instrumentation is a follow-up.

## Verification

1. Visit a video page → `jfp_session` cookie is set with a UUID value
2. Watch a video for >30% → `watch_events` table has a row with `is_bounce = false`
3. Watch <30% and navigate away → row exists with `is_bounce = true`
4. `SELECT COUNT(*) FROM watch_events` grows as users interact
5. `SELECT session_id, COUNT(*) FROM watch_events GROUP BY session_id HAVING COUNT(*) > 1` returns sessions with multiple videos (prerequisite for FPMC training)
6. Geo/device/language columns populated from request headers
7. `sendBeacon` fires on tab close — no lost events on navigation
