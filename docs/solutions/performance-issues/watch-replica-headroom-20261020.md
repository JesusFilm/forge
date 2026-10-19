---
title: "Independent Web request processes restore Watch page headroom"
date: "2026-10-20"
module: "Watch production Web runtime"
problem_type: "performance_issue"
tags: [watch, railway, node, serialization, replicas]
---

The October 20 incident produced 4–13 second homepage first-byte times, including
an ISR cache HIT. The service had eight vCPUs available, but its single Next.js
JavaScript request thread consumed approximately 89% of one core. A short live
profile attributed 43.5% self time to React Flight serialization. Resource-limit
headroom therefore did not imply request-thread headroom.

With user authorization, increasing production Web from one to two replicas in
the same region added an independent request process without changing the active
release. Railway reported `2/2 Online`. Eight subsequent public GET probes had
0.21–0.53 second first-byte times. An origin sample of 204 successful page GETs
had 897 ms p95 versus 13,482 ms in the earlier 168-request sample. The populations
were not matched, so these are mitigation observations, not a controlled speedup.

Check settled replica state using `environment_status` with healthy services
included, and locate the exact service ID. The service-name filter returned no
matches even while `describe_service` found the service; an empty result must
never be reported as verified health. Confirm the active deployment ID remains
unchanged when applying replica-only changes.

Preserve the shared Redis cache and invalidation behavior across replicas.
Do not enable an uncoordinated local cache to conceal the same serialization cost.
Do not attribute the incident to the latest release solely from its timing.

See `docs/reports/2026-10-20-watch-production-latency.md` for evidence and cost
assumptions, and feat-747 for the remaining application-level repair. The
production-only `multiRegionConfig` setting in `apps/web/railway.toml` records the
mitigation; it does not change other environments' replica settings.
