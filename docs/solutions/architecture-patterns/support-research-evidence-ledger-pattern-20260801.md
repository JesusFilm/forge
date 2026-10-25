---
title: "Support research automation needs an evidence ledger before product actions"
date: 2026-08-01
problem_type: architecture
component: ai_agent
severity: high
module: apps/mastra
applies_when:
  - Turning support or feedback sources into automated product work
  - Validating user bug reports with bounded automation
  - Creating Linear issues from model-classified evidence
tags:
  - support
  - user-research
  - privacy
  - outbox
  - idempotency
  - linear
related_components:
  - apps/mastra/src/mastra/workflows/daily-support-research.ts
  - apps/mastra/src/services/support-research
  - apps/mastra/migrations/002-support-research.sql
related:
  - docs/solutions/conventions/single-service-http-client-result-union-convention.md
  - docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md
---

## Problem

Directly prompting a model with support tickets and letting it call issue tools
combines untrusted customer text, personal data, uncertain inference, and
irreversible side effects in one boundary. Retries can duplicate tickets,
successful HTTP checks can be overstated as browser proof, and repeated UX
signals have no durable place to accumulate.

## Pattern

Place a code-enforced sanitizer before both model use and persistence, then use
an append-oriented Observation → Cluster → Action ledger:

1. Capture a fixed source window and persist a temporal cursor only through
   durably handled sources. Re-read a small overlap and deduplicate by source ID.
2. Remove direct identifiers, quoted history, raw HTML, tokens, and attachments;
   pass one bounded sanitized source to a tool-free structured-output agent.
3. Preserve user-reported evidence, automated evidence, and model inference in
   separate fields. Restrict validators to exact code-configured targets and
   describe the narrow behavior each check proves.
4. Store the observation before applying deterministic thresholds. Cluster
   recurring usability/need signals by versioned surface/theme fingerprint.
5. Put every external create in a database outbox with a stable marker. On an
   ambiguous response, search the destination for that marker before retrying.
6. Budget actions and keep the system default-off. Dry runs exercise ingestion,
   analysis, validation, clustering, and reporting while suppressing writes.

This ordering makes upstream data and model judgment evidence for a policy,
not authority to act. External failure does not lose observations, and internal
uniqueness plus destination reconciliation makes action creation retry-safe.

## Truthfulness boundary

A public GET that returns the reported 404/5xx confirms that exact response for
that exact URL. It does not confirm playback, controls, account state, device
behavior, intermittent failures, or general user impact. Surface those reports
as `Needs validation` with the missing proof; do not convert confidence into a
claim of reproduction.

## Privacy boundary

Sanitization is minimization, not guaranteed anonymization. Enable only with an
approved model/data-processing boundary, exclude attachment bytes, redact
prompt bodies from observability, retain minimized excerpts for a bounded
period, and keep logs/errors to safe identifiers and reason codes.
