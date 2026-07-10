# Smart Crop: decomposing a "Mastra-orchestrated" PRD onto Forge's ownership law

**Date:** 2026-06-10
**Feature:** feat-173 Smart Crop (docs/plans/2026-06-09-002-feat-smart-crop-plan.md)
**Category:** architecture-patterns

## Problem

The Smart Crop PRD assigned end-to-end pipeline ownership to Mastra
("Mastra Smart Crop Workflow" driving analysis → plan → render → Mux output)
and specified worker→manager progress callbacks plus a nested
`smart-crop/...` artifact hierarchy. All three clash with repo reality:
Mastra workflows run synchronously inside HTTP requests (~120s caller
budget) with no S3/Mux access; manager has no inbound callback surface; the
storage validator only allows flat `{assetId}/{artifactType}.{ext}` keys.

## Solution shape (reusable for any heavy AI+media PRD)

1. **Durable control loop in manager** (`workflow` SDK pipeline, like
   `videoEnrichment`), owning job state via the existing JobRecord contract
   with an `options.<feature>` block as the kind discriminator — zero admin
   schema changes because options/steps are JSON and step name is a plain
   GraphQL String. Job/step statuses stay inside the closed enums; feature
   phase detail lives in a `{kind:"metadata"}` artifact entry.
2. **Bounded synchronous AI decisions in mastra** — one `/forge-*` route per
   decision type (plan / align / qa), each sized to fit one HTTP call;
   manager chunks unbounded work (per-shot batches) into bounded calls.
   Frames arrive as host-allowlisted https URLs, never bytes.
3. **Bytes in a dedicated plain-node worker** (template:
   yt-video-mapper-backend) with its own S3 client; manager **polls** worker
   job status from a durable step instead of receiving callbacks — single
   mechanism, restart-resilient (worker restart ⇒ 404 ⇒ bounded resubmit),
   no new inbound auth surface.

## Hardening patterns the Tier-2 review forced (apply from day one next time)

- **Record-before-poll idempotency for external resource creation:** persist
  the created Mux asset id to a durable artifact IMMEDIATELY after create and
  BEFORE readiness polling, so a retried step resumes the same asset instead
  of minting duplicates. Generalizes to any create-then-wait external API.
- **Checkpoint chunked AI work:** per-batch progress artifact (with source
  provenance, e.g. fingerprint `generatedAt`) so retries resume from the
  first incomplete batch — "retry must not redo AI" needs an actual
  checkpoint, not just final-artifact skip checks.
- **Skip paths must parse + provenance-check, not just `artifactExists`:**
  a malformed or stale-from-a-prior-run artifact silently poisons reuse.
  Stamp provenance (upstream artifact timestamps) into derived artifacts and
  recompute on mismatch.
- **Classify deterministic vs transient step failures:** durable-workflow
  SDKs retry thrown errors; deterministic failures (gate fail, not-approved,
  dimension mismatch, malformed artifact, non-retryable upstream reasons)
  must throw the SDK's `FatalError` (the `workflow` package exports it) or
  they get retried 3× — at vision-LLM prices.
- **Config-shaped upstream failures degrade advisory steps, they don't fail
  jobs:** QA returning `frame_host_not_allowed`/`provider_config_missing`
  means "QA unavailable", not "video failed QA". Map config reasons to a
  skipped step with a reason; reserve step failure for real verdicts.
- **Worker-side active-job dedupe key excludes the caller's job id:** dedupe
  on logical identity (kind + assetId + mode) so a re-launched manager
  workflow re-attaches to the still-running render instead of doubling
  multi-hour ffmpeg load.
- **Deadline chain:** worker per-JOB deadlines strictly below manager's poll
  ceilings (25min/25min/5.5h vs 30min/30min/6h), with each ffmpeg
  invocation's timeout capped at the remaining budget — otherwise the
  caller's classifier wins the race while the child keeps burning CPU.
- **ffmpeg `-protocol_whitelist` on attacker-influenceable inputs**
  (`https,tls,tcp,crypto,hls` in production; `+file` only outside) even when
  the bearer trust model "should" prevent hostile URLs — defense in depth
  against `file:`/`concat:`/`data:` reads landing in rendered output.

## Real-binary smoke beats mocked argv tests

Mocked `RunCommand` tests prove argv SHAPE; only a real ffmpeg run proves
ffmpeg accepts the argv (quoted `min(t/D,1)` crop expressions, scdet/showinfo
parsing, rawvideo dhash piping). The 5-minute recipe that validated the whole
worker before any deploy: generate a synthetic source with hard cuts
(`-f lavfi` testsrc2/smptebars/mandelbrot + concat + sine audio), run the dev
server against a temp artifacts dir, POST fingerprint → assert shot
boundaries land exactly at the cut points, hand-write a crop plan with an
animated pan, POST render → ffprobe the output (1080x1920 h264+aac) and
eyeball a mid-pan extracted frame. Add this to the mocked-shape-vs-real-
contract META list (docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md).
