---
id: "feat-399"
title: "Replace Watch Google Form with native Linear feedback"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
duration: 3
depends_on:
  - "feat-250"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "feedback"
  - "linear"
---

## Problem

The global Watch feedback surface embeds a Google Form inside Forge's modal.
That creates nested scrolling, breaks the visual continuity of Watch, depends
on a third-party form UI, and requires people to manually describe page and
device context that the site can provide safely. Feedback also does not enter
the team's Linear workflow directly.

## Entry Points — Read These First

1. `apps/web/src/components/FeedbackLauncher.tsx` — lazy modal entry point,
   global search coordination, and focus restoration.
2. `apps/web/src/components/FeedbackModal.tsx` — current Google Form iframe.
3. `apps/web/src/components/FeedbackLauncher.test.tsx` — modal loading and
   launcher behavior coverage.
4. `apps/web/src/components/ui/dialog.tsx` — shared accessible dialog surface.
5. `apps/mastra/src/services/support-research/linear-client.ts` — existing
   bounded Linear GraphQL client and failure-classification precedent.
6. `docs/roadmap/platform/feat-250-web-global-feedback-modal.md` — original
   global feedback entry-point contract.

## Grep These

- `FeedbackModal`
- `FEEDBACK_EMBED_URL`
- `useFloatingSearchPinned`
- `LINEAR_API_KEY`
- `api.linear.app/graphql`
- `WatchModalViewportCloseButton`

## What To Build

1. Replace the iframe with a responsive five-step native form matching the
   selected Forge design: category, language/content context, optional element
   selection, contextual description with diagnostics, and contact details.
   Require a name and keep email optional.
   Reuse Watch's searchable language combobox and use direct Watch title
   suggestions for selecting media or collections. Keep both lookups
   non-blocking: accept manually entered languages and typed content titles
   when no match exists or a lookup service is unavailable.
2. Capture only bounded, non-sensitive diagnostics with explicit consent:
   browser, operating system, device class, viewport, page URL/title, locale,
   time zone, and app version. Let the person preview the attached values.
3. Let a person temporarily dismiss the modal and point to a visible page
   element. Store a bounded human-readable label and conservative DOM path;
   never capture input values, hidden content, or arbitrary page HTML.
4. Add a Server Action that validates and rate-limits public
   submissions, keeps Linear credentials server-only, creates a sanitized
   issue in the configured Linear team, and returns a generic receipt.
5. Preserve lazy loading, search mutual exclusion, dialog accessibility,
   focus restoration, mobile safe areas, and no feedback network work before
   user intent.

## Constraints

- Do not expose Linear credentials, team ids, issue ids, or private issue URLs
  to the browser or submitter.
- Do not collect passwords, cookies, storage values, form contents, full DOM,
  screenshots, IP-derived location, or playback/account identifiers.
- Bound every public string and object before constructing the Linear payload.
- Keep the integration opt-in at deploy time; missing Linear configuration
  must fail safely without breaking Watch page rendering.
- Do not add a database or durable user-profile store for this feature.
- Keep the public form usable when element selection or diagnostics are
  unavailable.

## Verification

- Focused component tests cover categories, conditional copy, impact, required
  identity fields, diagnostic consent/preview, element-selection handoff,
  validation, loading, success, retry, close, and focus behavior.
- Server Action tests cover schema rejection, rate limits, sanitization,
  Linear payload mapping, timeout/failure handling, log redaction, and missing
  configuration.
- Web typecheck, lint, formatting, focused tests, and production build pass.
- Desktop and mobile browser checks exercise the full form without making a
  real Linear issue, compare the rendered modal to the selected design, and
  confirm no Google or Linear request is made from the browser.
- Page-loading verification confirms the modal chunk and submission work stay
  off the initial Watch load path.
