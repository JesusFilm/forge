---
module: Studio
problem_type: architecture_pattern
tags: [studio, review, rendering, approvals, narration]
date: 2026-09-23
---

# Human review follows immutable output, not the latest render card

A handoff must carry both revision and render attempt. The editor opens its lazy
review panel for those parameters and resolves the exact attempt independently
of the recent render list. Do not replace that selection with the newest result
for the current revision. A completed private render is reviewable before Mux or
catalog staging; source its output through the canonical inspection context.

Keep historical evidence read-only when the project advances. Browser checks
include both the latest canonical revision and local editor saved state; Admin
still validates the exact revision/render under its lock. Script approval and
render approval use their own stable retry keys and cannot impersonate a delegated
actor. Human review displays the selected rendered document's effective speech,
voice version, provider/model, settings and pronunciation identity.

Review metadata strips cached sample payloads before returning to the browser.
Inspection extraction and sample images load only on explicit request. Preserve
this seam when adding summaries: opening the ordinary editor should not load an
MP4 or a full inspection package.

Narration allowance authorization is a durable command separate from provider
execution. Keep an uncertain authorization's complete original payload and retry
key, including revision and pass count. A retry cannot silently become a new grant.
A definitive revision conflict can be explicitly discarded before renewed consent;
unknown transport outcomes must keep the original command. New grants reread the
canonical revision without reloading away local human edits.
The internal zero-dollar reservation does not mean a free quote; display pricing
as unavailable unless a verified quote exists.
