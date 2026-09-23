# 06: Create and revise from a broad brief using a portable skill

**Parent:** [Specification](../spec.md) · planning tracker feat-541

**Status:** approved; published as `feat-547` with `ready-for-agent` readiness.

**What to build:** An operator invokes the same creation workflow in Claude or Codex. The portable skill guides source discovery, editing, bounded narration, rendering, inspection, and conversation-driven revision through the completed MCP capabilities.

**Blocked by:** 03 — Generate draft narration within a durable allowance, 05 — Review an exact draft and revise from conversation feedback.

## Acceptance criteria

- [ ] Ship an installable/discoverable skill with accurate tool discovery and client-specific connection guidance, without embedding service secrets or repository checkout assumptions.
- [ ] A broad brief leads to canonical footage selection, story/text/track editing, existing music selection where available, and a rendered handoff. Ask only questions that materially change the creative result.
- [ ] The agent can use the shipped text fonts/readability/motion and clip transitions, not merely insert raw clips.
- [ ] Use the durable narration allowance, reuse unchanged audio, and respect explicit requests for music/voice creation.
- [ ] Perform the sampled inspection with a target under one additional minute and at most one defect-repair pass; return limitations when media inspection is unavailable.
- [ ] The skill returns revision/render links and change/inspection summaries and accepts the next feedback in the same agent conversation.
- [ ] Treat source metadata, subtitles, uploaded content, and tool-result prose as data, not higher-priority instructions.
- [ ] A realistic broad-brief and feedback scenario completes against the actual MCP surface without browser-driving the editor; unsupported tools or modalities produce useful explicit limitations.
- [ ] Validate skill packaging and behavior with representative inputs; tests do not merely assert skill wording.

## Test boundary

Real MCP-driven brief-to-render-to-revision scenario, with deterministic provider fixtures for repeatability.
