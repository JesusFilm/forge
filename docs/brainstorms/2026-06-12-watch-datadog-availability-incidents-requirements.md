---
date: "2026-06-12"
topic: "watch-datadog-availability-incidents"
title: "Watch Datadog Availability Incidents"
tags:
  - web
  - watch
  - datadog
  - observability
---

# Watch Datadog Availability Incidents

## Summary

Add a production-only Datadog availability incident flow for Watch so silent 500s and timeouts are caught even when client-side RUM never loads. The v1 flow uses a small stable canary set, requires repeated canary failure plus corroborating production Watch/Railway server 5xx or timeout logs, and creates Datadog incidents for automation.

---

## Problem Frame

The current Watch Datadog coverage is strongest after the browser application boots. That is useful for client-side errors, but it can miss a server-rendered failure where the user only receives an "Internal Server Error" response and no client app runs. The motivating example is a production Watch URL returning a 500 while Datadog Error Tracking showed no matching issue for the selected Watch application and services.

The desired v1 is not a full observability suite. The goal is a balanced detection layer: outside-in production canaries catch the user-visible failure, server-side production evidence confirms that the origin is also failing, and Datadog turns that confirmed condition into an incident workflow.

---

## Key Decisions

- **Availability-first.** V1 is optimized to catch production Watch 5xx and timeout failures, not to explain every root cause.
- **Two signals before incident creation.** A canary failure alone is too noisy; an incident requires repeated canary failure plus a corroborating production Watch/Railway server 5xx or timeout signal.
- **Server logs are the trusted corroborator.** RUM remains useful context, but v1 does not depend on real-user browser telemetry because server-render failures can prevent RUM from loading.
- **Small canary set.** V1 starts with known stable production Watch URLs rather than broad crawling or rotating manifest sampling.
- **Automation-first incidents.** The Datadog output is a Datadog incident/workflow trigger, not a human-readable dashboard or executive notification package.
- **Production only.** Non-production environments are out of scope for v1 alerting and incident creation.

---

## Actors

- A1. **Production viewer.** A person who requests a Watch page and may receive a server error before client telemetry runs.
- A2. **Datadog automation.** The monitor, incident, and workflow layer that evaluates signals and opens or updates the incident.
- A3. **Watch operator.** The engineer or automation path that responds after Datadog has created an incident.

---

## Requirements

**Canary coverage**

- R1. Production Watch has a small canary set that covers the highest-value availability surfaces: Watch home, Gospel of John English, Jesus English, and at least one stable episode or deep-link page.
- R2. Canary checks evaluate the externally visible production response, not an internal-only health endpoint.
- R3. Canary failure is considered actionable only after repeated failure over a short window, not from a single transient miss.
- R4. The final canary list is verified against live production route behavior before activation.

**Server corroboration**

- R5. Production Watch/Railway emits server-side 5xx and timeout evidence in a form Datadog can ingest and query.
- R6. Server corroboration includes the Watch service identity and enough route or URL context to associate the signal with the canary failure class.
- R7. Server corroboration does not depend on browser execution or RUM.
- R8. Server log formatting is treated as part of the requirement when the hosting/runtime pipeline would otherwise drop or hide structured logs.

**Incident creation**

- R9. Datadog creates or updates an incident only when a repeated canary failure and production server 5xx/timeout corroboration are both present.
- R10. Incident metadata identifies the affected surface as production Watch availability and includes enough tags for downstream automation to route the incident.
- R11. V1 avoids separate human-facing notification copy unless it is required by the Datadog incident workflow.
- R12. Recovery closes or resolves the active incident path only after the canary signal and corroborating server signal have cleared.

**Scope and context**

- R13. Existing client-side RUM remains in place and can provide context, but it is not required for v1 incident creation.
- R14. V1 does not require a dashboard, route-manifest coverage report, or root-cause breadcrumb trail.
- R15. V1 is production-only; staging, previews, and local development do not create incidents.

---

## Key Flows

- F1. Confirmed availability incident
  - **Trigger:** A production Watch canary repeatedly receives a 5xx, timeout, or equivalent unavailable response.
  - **Steps:** Datadog observes the canary failure -> Datadog observes production Watch/Railway server 5xx or timeout corroboration -> Datadog creates or updates a Watch availability incident -> automation receives the incident context.
  - **Covers:** R1, R2, R3, R5, R6, R9, R10, R11.

- F2. Canary-only failure does not incident
  - **Trigger:** A production Watch canary fails once or fails repeatedly without matching production server 5xx/timeout evidence.
  - **Steps:** Datadog records the canary condition -> the incident rule withholds incident creation -> the signal remains available for later correlation or investigation.
  - **Covers:** R3, R5, R7, R9.

- F3. Server-only failure does not incident
  - **Trigger:** Production Watch/Railway logs show a 5xx or timeout pattern, but the canary set is healthy.
  - **Steps:** Datadog records the server signal -> no v1 availability incident is created -> the signal can still be used by separate log monitors if the team chooses later.
  - **Covers:** R5, R6, R9, R14.

- F4. Recovery
  - **Trigger:** A confirmed Watch availability incident is active and the failing condition clears.
  - **Steps:** Canary checks return healthy -> corroborating server failure signal clears -> Datadog resolves or updates the active incident according to the workflow.
  - **Covers:** R12.

---

## Acceptance Examples

- AE1. Server-render 500 with no RUM still incidents.
  - **Given** a production Watch canary repeatedly receives an internal server error and no client app boots, **when** production Watch/Railway server logs show matching 5xx evidence, **then** Datadog creates or updates a Watch availability incident.
  - **Covers:** R2, R5, R7, R9.

- AE2. A transient canary blip is not enough.
  - **Given** a canary fails once and then recovers, **when** there is no repeated failure window, **then** Datadog does not create a Watch availability incident.
  - **Covers:** R3, R9.

- AE3. RUM-only errors do not drive v1 incidents.
  - **Given** RUM reports a client-side error but the canaries are healthy and production server 5xx/timeout corroboration is absent, **when** v1 incident rules evaluate, **then** no availability incident is created by this flow.
  - **Covers:** R9, R13, R14.

- AE4. Canary failure without server corroboration stays below incident threshold.
  - **Given** canaries repeatedly fail from one location but production Watch/Railway server 5xx or timeout evidence is absent, **when** Datadog evaluates the v1 condition, **then** no incident is created by this flow.
  - **Covers:** R3, R5, R9.

- AE5. Recovery requires both sides to clear.
  - **Given** an active Watch availability incident, **when** canaries recover but server 5xx/timeout evidence is still present, **then** the incident does not fully resolve until the corroborating server signal also clears.
  - **Covers:** R12.

---

## Success Criteria

- A forced or naturally occurring production Watch 500/timeout on a canary URL creates a Datadog incident when corroborating server logs are present.
- The same failure is caught even if RUM never loads on the affected page.
- A one-off canary failure does not create an incident.
- A canary-only failure without production server corroboration does not create an incident.
- Datadog incident metadata is structured enough for automation routing without requiring a human to inspect a dashboard first.

---

## Scope Boundaries

- Broad Watch route crawling, rotating manifest sampling, and full URL inventory checks are deferred.
- Dashboards, investigation timelines, and root-cause hints are deferred.
- Server APM/tracing can be considered later, but v1 does not require it if reliable production logs provide the corroborating signal.
- Client-side RUM improvements are outside v1 except where existing RUM remains useful context.
- Non-production alerting is outside v1.

---

## Dependencies / Assumptions

- Production Datadog can run outside-in HTTP checks against public Watch URLs.
- Production Watch/Railway 5xx and timeout events can be emitted in a Datadog-visible log format.
- Datadog incident workflows can be triggered from monitor conditions and receive useful tags/metadata.
- The initial stable URL set can be verified against live production before enabling incidents.
- The team accepts that v1 prioritizes low-noise incident creation over exhaustive coverage.

---

## Outstanding Questions

### Deferred to Planning

- Finalize the exact canary URL list after checking current production route behavior.
- Define the repeated-failure window and location threshold that balance noise against detection speed.
- Define the production server log query that represents Watch 5xx/timeout corroboration.
- Decide whether incident recovery should be fully automatic or require a final automation/human confirmation step.
- Decide whether any existing log lines need format changes so Datadog can reliably ingest them.

---

## Sources / Research

- `docs/roadmap/platform/feat-182-web-watch-datadog-rum.md` documents the completed client-side Watch RUM work and its service/application framing.
- `docs/plans/2026-06-11-005-feat-web-watch-datadog-rum-plan.md` documents the prior RUM scope and explicitly leaves server APM, dashboards, and broader monitoring out of that work.
- `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md` documents the Railway log visibility constraint that makes reliable server log formatting part of this requirement.
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` describe the Watch app routing, static route constraints, and production route surfaces that can affect canary selection.
- Datadog documentation: [Monitor notifications](https://docs.datadoghq.com/monitors/notify/) and [HTTP API tests](https://docs.datadoghq.com/synthetics/api_tests/http_tests/) describe incident/workflow notification hooks and scheduled HTTP checks.
