---
title: "Keep recommendation seed validation aligned with canonical content slugs"
date: "2026-09-16"
module: "Watch recommendation delivery"
problem_type: "integration_issue"
component: "service_object"
symptoms:
  - "A recommended video opens and plays, but its next recommendation request returns HTTP 400"
  - "Valid catalog slugs containing repeated hyphens or underscores fail the delivery boundary"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
tags: [recommendations, watch, routes, validation, canonical-slugs]
---

# Validate the same content domain at every boundary

The production viewing-mode regression followed a recommendation to
`origins-of-christmas--episode-1`. Preview playback and profile attribution worked,
but the destination recommendation request failed with HTTP 400. The optional
`seedMediaSlug` field required single-hyphen kebab case while Watch's canonical
`ContentSlug` accepts lowercase ASCII digits, repeated hyphens and underscores.

Use `tryAsContentSlug` from `apps/web/src/lib/routes.ts` in the delivery schema,
retaining its request-specific 191-character bound. A local regex that looks
reasonable can still reject real catalog identities and interrupt navigation
chains. Do not normalize or rewrite an existing slug to satisfy that regex.

The regression first proved both the live repeated-hyphen shape and the existing
underscore content shape returned 400. Boundary tests then require successful
serving for both, and retain rejection of empty, oversized, slash, encoded-slash
and query-bearing input before any Admin request. This changes neither the
canonical route nor the audio-language domain.

The fix adds no network request, observer or render work. Sequential contract,
security, correctness and maintainability review checked the shared helper's
character set, the length bound and unchanged admission/attribution. Verify the
exact public destination after normal deployment; a unit-only green result does
not establish that the live recommendation chain recovered.
