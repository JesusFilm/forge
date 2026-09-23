---
module: Shorts external-agent inspection
problem_type: architecture_pattern
tags: [shorts, mcp, inspection, retained-media, authority, performance]
date: 2026-09-23
---

# Inspect retained output without inventing inspection authority

Use `inspection-context` to establish current caller authority and exact completed
attempt/revision/manifest/output identity. It is a cheap lazy read, not extraction.
Manager's `inspectStudioRender` accepts either the interactive or delegated
adapter, downloads digest-verified retained MP4 bytes and invokes bounded local
FFmpeg. Source subtitles, timeline metadata and codec-success records do not
constitute rendered visual inspection.

Keep measured rendered pixels/decoded audio separate from composition heuristics.
The composition does not record gap intent: an uncovered interval is authored,
but only the author can confirm it is deliberate. Potential text overflow is an
estimate, not OCR. A client must say which returned MCP image blocks it viewed;
audio statistics cannot establish that it listened.

Persist only successful sampled evidence through the server-only
`inspection-save` render-worker command. Migration 0102 retains an immutable
attempt/version/output-bound record, including bounded JPEG bytes. Failed or
unsupported preparations stay uncached: otherwise an initial missing binary or
transient timeout would permanently poison an immutable cache. Explicit retry
can recover without rerendering; a successful prior record remains unchanged.

Every asynchronous boundary needs a deadline, including the delegated capability
request before the byte fetch. A 45-second FFmpeg timer alone leaves a 100-second
service request holding the extraction slot. Signal-aware transport plus bounded
adapter waits protect capability/context reads, and current authority is checked
again before evidence is returned. Final persistence has its own short budget.

Per-image limits do not imply a bounded report: base64 expansion plus many text
warnings can exceed transport limits. Bound the serialized report, prioritize
measured findings and disclose omissions. Preserve exact output timestamps and
separate rendering, evidence preparation, client reasoning and optional repair
time; local decoder speed is not evidence of a completed real-client inspection.
