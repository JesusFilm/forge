---
id: "feat-353"
title: "Redact IPv6 values from the SEO persistence boundary"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-352"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "admin"
  - "seo"
  - "security"
---

## Problem

Mastra and Admin consistently redact IPv4 values at the SEO persistence
boundary, but neither text redactor currently recognizes IPv6 literals. This
does not break proposal digest compatibility because both sides behave the same
way, but it leaves a privacy gap for provider or page content containing an IPv6
address.

## Entry Points — Read These First

1. `apps/mastra/src/services/seo-data-minimization.ts` — producer-side text and URL minimization.
2. `apps/admin/src/services/seo-experiment.service.ts` — authoritative persistence redaction.
3. `docs/solutions/architecture-patterns/mastra-seo-experiment-ledger-boundary.md` — fixed-point digest boundary.

## What To Build

1. Add bounded IPv6 literal detection to both text-redaction implementations.
2. Preserve the fixed-point invariant: Admin redaction must leave every Mastra
   persistence payload byte-identical.
3. Cover compressed, full, IPv4-mapped, URL-host, and ordinary colon-delimited
   non-IP text cases without logging raw addresses.

## Constraints

- Do not broaden outbound URL allowlists or authorize HTTP fetches.
- Do not weaken existing email, credential, IPv4, or sensitive-key redaction.
- Keep live proposal completion fail-closed on any digest mismatch.

## Verification

- Focused Mastra and Admin redaction suites pass.
- A shared contract corpus proves identical producer and consumer projections.
- Existing SEO proposal, run-fencing, and approval-boundary tests remain green.

## Resolution

Mastra and Admin now use Node's authoritative IP parser to redact bounded IPv6
candidates, including full, compressed, IPv4-mapped, and bracketed URL-host
forms. Ordinary colon-delimited text remains unchanged, and Mastra converts
sensitive URL hosts to the stable `redacted.invalid` persistence placeholder so
Admin's defensive redaction remains a fixed point.
