# 04: Inspect a rendered draft quickly with attributable evidence

**Parent:** [Specification](../spec.md) · planning tracker feat-541

**Status:** approved; published as `feat-545` with `ready-for-agent` readiness.

**What to build:** The external agent retrieves a bounded evidence package for the exact rendered draft, performs a quick quality pass, and hands off honest findings and inspection coverage.

**Blocked by:** 02 — Request and retrieve an exact draft render.

## Acceptance criteria

- [ ] Evidence identifies the exact project revision, render, duration, sampled timestamps, and evidence-generation version.
- [ ] Provide representative frames and cut-adjacent samples plus deterministic gap, text-overflow, and audio checks where technically supported. Intentional gaps are distinguishable from suspected defects.
- [ ] Evidence comes from the same output the human reviews; render success or composition metadata alone is not claimed as visual/audio inspection.
- [ ] Bound the number/size of samples and processing time. Repeated inspection of the same artifact reuses evidence instead of rerendering.
- [ ] The agent reports supported modalities, sampled coverage, findings, and unknowns; a client without audio/video inspection capability does not claim it listened/watched.
- [ ] Measure additional time from output readiness to completed inspection, separating server preparation and client reasoning. Target under 60 seconds on a documented representative short; report misses honestly.
- [ ] Publish fixture results for clean output, deliberate gaps, unreadable/overflowing text, cut defects, and audio defects. Report detector limitations and false positives rather than claiming universal detection.
- [ ] At most one automatic repair pass is prescribed per review handoff. Any repair render is separately timed; remaining defects/timeouts return an incomplete inspection summary.
- [ ] Inspection results are advisory and never human approval. Heavy evidence work does not execute during editor page initialization.

## Test boundary

MCP evidence retrieval plus actual contained-render fixtures and representative client inspection timing.
