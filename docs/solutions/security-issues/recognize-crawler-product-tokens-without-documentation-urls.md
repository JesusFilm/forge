---
title: Recognize crawler product tokens without documentation URLs
date: "2026-09-21"
category: security-issues
module: Watch recommendation evidence admission
problem_type: security_issue
component: authentication
severity: medium
symptoms:
  - Short Meta crawler user agents passed the human evidence admission guard.
  - Otherwise valid crawler evidence and selection requests reached Admin mutations.
root_cause: missing_validation
resolution_type: code_fix
tags:
  - recommendations
  - crawler-admission
  - user-agent
  - evidence-integrity
---

# Recognize crawler product tokens without documentation URLs

## Problem

The recognized-machine guard matched generic `bot`, `crawler` and related
tokens. A full Meta crawler user agent happened to match because its documentation
URL contained `/crawler`. The short `meta-externalagent/1.1` and
`Meta-ExternalFetcher/1.1` forms did not match. With valid request headers and
bodies, evidence and selection handlers called Admin and returned HTTP 200.

Cloudflare's verified bot directory identifies
[Meta-ExternalAgent, including its short user agent](https://radar.cloudflare.com/bots/directory/meta-externalagent)
and [Meta-ExternalFetcher](https://radar.cloudflare.com/bots/directory/meta-externalfetcher).
The full sampled production Meta user agent was already rejected. This local
reproduction does not establish that the short forms contaminated production.

## Solution

Extend the existing case-insensitive guard in
`apps/web/src/lib/recommendation-human-admission.ts` with
`meta-external(?:agent|fetcher)`. Match the declared crawler product independently
of its optional documentation URL. Preserve ordinary Facebook in-app browsers,
unknown user agents, exact-origin checks, rate limits and authorization.

The regression first failed seven assertions: the helper admitted the three
new crawler fixtures, and evidence/selection handlers returned 200 for the two
short forms. After the fix, all 67 focused tests passed. Playback context,
claim and facts tests also assert HTTP 403 `machine_evidence_rejected` before
any Admin mutation. The full Web suite passed 4,455 tests; lint and typecheck
passed. No rendering or client initialization code changed.

## Prevention

- Test minimal crawler product tokens, browser-wrapped forms and mixed case.
  A long fixture can pass because of an unrelated substring in its URL.
- Include an ordinary browser from the same vendor as a negative control.
- Exercise the actual mutation route and assert that Admin is never called;
  a helper-only test does not verify enforcement placement.
- Keep recognized-machine exclusion distinct from proof of humanity. User-agent
  headers are forgeable, and missing or browser-like headers do not prove a
  request came from a person.
- Do not relabel or delete historical evidence without stored provenance that
  proves contamination. Retained spans are a sample, not a full denominator.

## Related

- [feat-464](../../roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md)
- [Recommendation boundary hardening](../architecture-patterns/production-recommendation-boundary-hardening-pattern.md)
- [Prior production release evidence](../../operations/watch-closeout-release-2026-09-21.md)
