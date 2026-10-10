# Watch Mobile Hero Autoplay Delay

## Context

The Watch hero's slow mobile autoplay start was an intentional side effect of
the poster-first idle autoplay work. Normal Watch loads rendered the poster
first, then waited for `window.load`, an 8 second fallback delay, and
`requestIdleCallback` before mounting the muted Mux preview.

That protected the mobile cold path from immediate video downloads, but it made
the above-the-fold mobile hero feel still for too long.

## Pattern

Keep the initial render poster-first, then split preview activation by viewport
posture:

- Visible mobile-width heroes schedule a short 700 ms activation timer after
  client commit.
- The activation still checks document visibility and near-viewport eligibility
  before mounting Mux.
- Desktop, hidden-document, and offscreen cases keep the conservative
  load-plus-idle path or retry only when visibility/viewport eligibility
  changes.
- Explicit user intent still wins through the existing `?autoplay=1`, saved
  progress, pointer-down, and click paths.

This gives the browser a first-paint opportunity without restoring Mux video
work to the server/client initial render.

## Evidence

- Focused HeroPlayer tests passed, including mobile fast activation,
  hidden-document deferral, poster-first initial render, explicit autoplay,
  click-before-idle, and the existing conservative idle cases.
- `apps/web` typecheck passed.
- `apps/web` lint passed.
- Review pass found no actionable fixes.

## Browser Smoke Limitation

Local browser smoke could not be completed in this worktree because
`apps/web` has no local `.env`, `pnpm --filter @forge/web fetch-secrets` failed
with Doppler keyring access errors, and Watch routes require
`ADMIN_GRAPHQL_URL`, `WEB_ADMIN_API_KEYS`, and `REVALIDATION_SECRET` to boot
against admin data. There was no existing HeroPlayer fixture or Storybook route
that exercised the real browser path without those secrets.

## Follow-Up

Run a mobile-sized browser smoke on a seeded Watch route once local web secrets
are available. The expected runtime shape is: poster visible immediately, no
Mux backend on initial render, and one muted Mux backend mounted shortly after
first paint while the hero remains visible.
