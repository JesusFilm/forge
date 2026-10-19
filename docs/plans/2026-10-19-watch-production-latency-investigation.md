# Watch recurring production latency investigation

Owner: vlad. Execution: delegated Claude Opus 5.5. Tracking: feat-750 (renumbered from feat-745 before merge).

## Objective and boundaries

Explain recurring 6–30 second Watch responses with measured attribution, reproduce the responsible mechanism, and prepare a minimal tested repair if supported by evidence. Distinguish a code regression from deployment warm-up, resource contention, and dependency latency. Do not claim every deployment regresses based on one comparison.

Production investigation is read-only. No restart, rollback, scale change, flag change, cache purge, traffic stress test, or manual deployment. Proposed operational changes require a concrete recommendation for owner review. Code follows normal PR-to-main deployment. Preserve GA, Datadog RUM, URL-language policy, and recommendation policy. Read root and package AGENTS/CLAUDE before implementation. Do not revive feat-700's separately scoped renderer work without evidence and explicit scope review.

## Existing evidence — recheck before relying on current state

October 19, 2026, roughly 15:22–15:52 UTC:

- Checkly Watch keyword monitor failed in us-east-1 and ap-southeast-1 after three attempts, with 30-second test timeouts; LUMO page TTFB 24.5–25.2 seconds and LCP 25–28 seconds. Subsequent 15:32 and 15:42 runs failed too. These are multi-page checks, not root-only latency measurements.
- Root /watch curl: HTTP 200, TTFB 16.64 s, total 19.72 s. Later three sequential requests: TTFB 5.92 / 7.72 / 11.52 s; all x-nextjs-cache HIT and cf-cache-status DYNAMIC. Slow HIT excludes a cold render for those responses, but not queueing caused by other cold renders or cache-handler overhead.
- Datadog active version 3003c52046544d83b59f4acbea287ac04504dcf6 p95 18.2 s; previous 156666c296966c58e089619f6423c114223fd302 p95 1.38–1.50 s. Different time windows/traffic: correlation, not causal proof. Root route past-hour p95 19.9 s; catch-all 20.6 s. Low error rate does not establish usability.
- Railway web: one RUNNING instance, us-west2, sleeping false, 8 vCPU / 16 GB configured cap. Two-hour CPU peak ~1.91 vCPU, current ~1.68; RAM current ~2.15 GB, peak ~6.62 GB. Mean RAM fell from ~5.15 GB before deployment to ~1.97 GB afterward. Limits unchanged. Aggregate CPU does not rule out single-thread saturation or throttling.
- Web Redis: ~2.63 GB RAM / 24 GB, ~0.13 vCPU / 24, volume ~1.92 GB / 50 GB. Admin RAM ~2.02 GB / 24 GB. No evidence of container RAM exhaustion; runtime heap/GC and Redis internal limits still unmeasured.
- Railway healthcheck /watch allows 60 seconds. Deployment 772be46d-0d78-4faa-aa5e-43b8d5e010d2 SUCCESS at version 3003c520; another deployment 8824a12a-c140-4702-a8b5-179eeac10c2f WAITING (do not assume serving).

## Investigation sequence

1. **Capture current incident and timeline.** Record UTC, serving deployment/instance, route, cache state, status, DNS/connect/TLS/TTFB/total and body bytes for a small bounded sample of root, content, and lightweight existing endpoints. Correlate Checkly attempts, Railway deploy/start/restart events, and Datadog timestamps. Inspect previous deploys before asserting a recurring deployment pattern. Avoid long polling and production load generation.
2. **Attribute a slow cached response.** Obtain a concrete Datadog trace and breakdown: edge/origin wait, middleware, cache lookup/tag validation, serialization/compression/response write, admin calls and unexplained wall time. Compare with a fast HIT of the same route. Check event-loop delay/utilization, per-process/core CPU, GC/heap, active requests, restart/OOM and throttling evidence. Low total CPU or RAM is not enough to dismiss blocking.
3. **Inspect Redis read path.** Read-only INFO/stats, command latency/slowlog if access permits, clients, blocked clients, evictions, hit/miss ratio, internal maxmemory policy, persistence activity, network placement and reconnects. Never print credentials, scan all production keys, run MONITOR, change CONFIG, or flush. Inspect installed cache-handler version/source for tag-index scans, expiration cleanup, payload size and connection behavior. Stable configured prefix alone does not prove all framework keys survive deployment.
4. **Separate warm-up from persistent regression.** Determine build-ID/key behavior, startup registration/prepopulation, invalidation and TTL. Compare cold then repeated warm requests on an isolated production-mode fixture; test low bounded concurrency locally. Warm-up explanation needs an observed miss burst, bounded convergence and fast stable HITs; persistent slow HITs require another mechanism.
5. **Review exact deployed diff and runtime.** Compare 156666c… to 3003c520… and any intervening dependency/config changes. New audience flag calls are leads, not conclusions. Inspect feature-flag singleton/init timeouts, middleware, page serialization, synchronous cache work, tracing overhead and Next cache handler patches. Use installed versions and actual running configuration. Check existing solutions and unresolved findings before changing anything.
6. **Reproduce and repair.** Construct the smallest discriminating regression case using fake upstreams/isolated Redis and production-mode Next where relevant. Measure baseline versus fix under equivalent content, cache state and concurrency. Implement only an attributed fix; if evidence cannot identify cause, deliver an explicit evidence gap and narrow instrumentation patch rather than speculative tuning.
7. **Validate and hand off.** Run focused regression tests, package-required type/lint/format checks and realistic load/performance verification under I/O guard. Document evidence, rejected hypotheses, risks, proposed mitigation/rollback and acceptance checks. A local fix is not production recovery. Keep ticket in progress until required work is done; track production validation separately if rollout is pending.

## Access and exact entry points

- Railway CLI authenticated; no project link in this checkout. Pass project 98952497-a4d9-4714-8fe8-0cdbff3147c9 and production environment 5f41e037-90e4-4674-a3ea-66bbd05fb3b4 explicitly. Web service 23b82451-0da1-4edc-bcde-096a9fd2a687; Redis 940d9914-3156-4e41-8165-af96bfe66a53; admin bdb15048-1ca9-4217-ae01-ef7cc19ca6f4. Use railway metrics --help and railway api describe/search before queries.
- Checkly CLI authenticated to Jesus Film Project f02b7197-554a-4a15-8a40-3833838706e6. Skill /home/lado/.codex/skills/checkly/SKILL.md. Keyword check 54844597-f049-43fd-8808-06a2df8dbdfc; playback 380dc7b3-67c7-488d-a28f-e7d78e63b099; redirect 949a62aa-29d0-4e7f-8a3d-b8bb46a4d1aa.
- Datadog connector returned reauthentication required. Chrome profile is authenticated at app.datadoghq.com; T3 preview default profile was logged out. Follow browser discovery/fallback instructions, never reuse old tab IDs blindly. APM service forge-web, operation web.request. Browser env:\* metrics require validating production scope.
- Local evidence: /tmp/watch-recurrence.json, /tmp/checkly-\*.json, /tmp/watch-cache-headers-{1,2,3}, /tmp/forge-web-resources.json, /tmp/forge-deploy-config.json. Treat temporary artifacts as available starting evidence, not permanent storage. Sanitize durable evidence under docs/reports/.
- Code: apps/web/cache-handler.mjs, apps/web/src/instrumentation.ts, apps/web/next.config.mjs, apps/web/railway.toml, apps/web/src/proxy.ts, apps/web/src/lib/feature-flags.ts, packages/feature-flags/src/launchdarkly.ts, apps/web/src/app/[locale]/[htmlLang]/page.tsx and [...rest]/page.tsx, `apps/web/scripts/*cache*`.

## Deliverables and success criteria

- Incident report with timestamped measurements and causal confidence; attach exact trace/deployment IDs and sanitized command outputs.
- At least one test that distinguishes the leading hypothesis from alternatives; measured warm-hit behavior before/after any repair.
- Minimal reviewable diff with relevant tests, or a precise blocker/instrumentation requirement. Prepare PR through normal flow if implementation is ready; register it with T3. No merge or production mutation without owner authorization.
- Proposed recovery acceptance: same-route warm-hit latency near the prior baseline, no 20–30 s stalls in a bounded verification window, Checkly paths passing, and preserved caching/analytics/content behavior. Set final thresholds from comparable baseline evidence, not arbitrary promises.

All heavy filesystem work must use /home/lado/.local/bin/agent-io-guard -- <foreground command>. Includes branches/worktrees, fetch/checkout, installs, builds and broad tests. Do not weaken/bypass the gate; exit 75 retry later, exit 125 report/fix verification blocker. Use default disk thresholds and inherited full-access/auto-approval settings. Use Team subscription only; no API billing.
