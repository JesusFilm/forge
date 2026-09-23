# External-agent creation and review for Shorts

Status: approved by the operator on 2026-09-23, including test boundaries, ticket
granularity, dependencies, and the project authoring cycle allowance.
Planning tracker: feat-541. This document does not authorize production operations.

## Problem Statement

An operator wants to bring their existing Claude or Codex conversation to Shorts,
give a broad creative brief, and receive an edited, inspected video draft. Today
external agents can perform many project edits through MCP, but cannot complete
the draft-to-render loop through that surface. Browser-driven editing is fragile
and obscures which application and project state the agent is using.

The operator wants to spend their time reviewing creative output, not directing
individual timeline operations. Inspection matters, but should not introduce a
long second production cycle. Human corrections, approval, and publication must
remain understandable and under human control.

## Solution

Connect the operator's existing Claude or Codex through the Studio MCP resource.
A portable skill teaches the agent how to translate a brief into a project, find
canonical footage and existing assets, build the edit, generate permitted draft
narration, request a render, and inspect the resulting draft. Studio remains the
human review and direct-edit interface.

The agent returns a link to the exact reviewed revision and rendered output,
explains changes and inspection limits, and waits for feedback in its existing
conversation. The operator can give timestamped instructions in that conversation;
the agent rereads the project, reconciles human changes, and delivers another
revision. No editor comment system or automatic agent wakeup is required.

## User Stories

1. As an operator, I want to connect Claude or Codex that I already use, so that my existing conversation and brief remain the creative starting point.
2. As an operator, I want account-based scoped access, so that I do not distribute application service credentials to my agent.
3. As an operator, I want the agent to find my accessible projects, so that I do not need to locate internal identifiers.
4. As an operator, I want to provide a project link, so that the agent can resume the correct draft.
5. As an operator, I want to give a broad brief, so that the agent can develop a story and finished draft without asking about each edit.
6. As an operator, I want significant missing creative information surfaced, so that the agent asks only questions that materially affect the result.
7. As an operator, I want footage and subtitles grounded in canonical source identities, so that the agent can select accurate moments and language versions.
8. As an operator, I want reusable Content Packs and existing assets considered, so that established guidance and media can shape the result.
9. As an operator, I want the agent to control tracks, timing, text, fonts, readability, animation, and transitions, so that it can use the editor's current creative capabilities.
10. As an operator, I want draft narration using approved existing voices, so that a separate script approval does not interrupt every first draft.
11. As an operator, I want unchanged narration reused, so that visual revisions do not create avoidable voiceover charges.
12. As an operator, I want one initial narration generation and one correction pass per draft, so that unattended work has a concrete allowance.
13. As an operator, I want additional paid generation explicitly requested, so that a new conversation or retry cannot silently reset that allowance.
14. As an operator, I want existing music used by default, so that creating a draft does not unexpectedly generate paid music.
15. As an operator, I want new voice design or cloning explicitly authorized, so that the agent does not choose a new identity on its own.
16. As an operator, I want verified price estimates where available and honest uncertainty otherwise, so that unknown price is not presented as zero.
17. As an operator, I want the agent to start and check renders without operating browser controls, so that creation can finish in my agent conversation.
18. As an operator, I want failed, queued, and stale work clearly distinguished, so that I know whether a draft is ready for review.
19. As an operator, I want the agent to inspect the same rendered output I will review, so that its findings refer to actual output rather than only edit instructions.
20. As an operator, I want quick checks of gaps, text overflow, cuts, framing, and audio, so that obvious defects are caught before handoff.
21. As an operator, I want unsupported audio or video inspection reported, so that an agent does not claim to have seen or heard something it could not inspect.
22. As an operator, I want inspection time bounded, so that quality assurance does not become an open-ended polishing loop.
23. As an operator, I want at most one automatic repair pass per handoff, so that the agent can fix clear defects without repeatedly reworking creative choices.
24. As a reviewer, I want a link to the exact revision, render, and inspection summary, so that I know which draft I am evaluating.
25. As a reviewer, I want to give feedback in my Claude or Codex conversation, so that I do not need a new commenting workflow.
26. As a reviewer, I want to correct the edit directly in Studio, so that precise manual changes remain possible.
27. As a reviewer, I want my direct edits preserved when the agent resumes, so that concurrent work cannot silently overwrite my decisions.
28. As a reviewer, I want a concise change summary and access to previous revisions, so that I can compare results and restore an earlier draft.
29. As a reviewer, I want final script, voice, and rendered-output approval to remain human, so that machine inspection cannot approve publication.
30. As an operator, I want retries and reconnections to reuse accepted work safely, so that interrupted sessions do not duplicate edits, renders, or provider charges.
31. As an operator, I want publishing and destructive actions to require human approval, so that draft-authoring permission does not imply release permission.
32. As an operator, I want both supported clients proven through creation and revision, so that the workflow is usable rather than only theoretically MCP-compatible.

## Implementation Decisions

- Extend the existing Studio MCP resource and canonical Admin-owned authoring module. Retain the current shared contracts, attributed immutable revisions, expected-revision checks, and idempotency receipts. Do not create a parallel authoring database or use a retired Shorts implementation.
- Use existing OAuth application/environment grants, current operator membership, and client attribution. Introduce narrowly consented delegated execution capabilities where needed. Existing edit permission alone must not silently acquire paid-generation or publication authority.
- Provide bounded project discovery and unambiguous project/revision links, then delegated render request/status and scoped access to completed output. Tool names and exact schemas are implementation details; preserve compatibility with existing tools.
- Reuse canonical source capture and trusted media materialization. The agent selects source identities, not arbitrary server-fetch URLs. Agent-generated code and external content remain untrusted inputs under existing composition containment.
- Separate draft narration execution from human script approval. Add explicit delegated admission using approved existing voice identities and the agreed allowance. Do not impersonate an interactive reviewer or fabricate script approval to unlock current execution routes.
- For implementation, define the allowance's draft boundary as one project authoring cycle, stable across revisions, retries, clients, and agent sessions. One initial generation pass and one correction pass cover that cycle; a pass may include several changed speech items. A new allowance for the same project requires explicit human authorization. Record this interpretation in user-visible allowance information.
- Enforce allowance and idempotent admission durably before provider execution. Reuse unchanged audio by complete effective speech/voice identity. Ambiguous provider outcomes require reconciliation rather than blind paid retries. A correction resulting from inspection consumes the same correction allowance.
- Existing music is the default. New music generation, voice design, and cloning remain explicit-request flows using existing product mechanisms; no new voice-cloning capability is implied.
- Drop the previously proposed $5 default. Show account-verified estimates when present and generation allowance when price is unknown. Existing worker rendering consumes infrastructure; a missing render cost is not evidence of zero cost or justification for a fabricated per-render charge. Agent subscription usage remains outside Studio accounting.
- The render service owns asynchronous execution, bounded concurrency, recovery, and immutable output identity. MCP requests return durable job/attempt identities promptly and expose bounded polling; client disconnects do not discard work.
- Bind inspection evidence to exact revision and render identity. Generate bounded representative frames and cut-adjacent samples plus deterministic composition/media checks. Distinguish an authored gap from an accidental uncovered interval, and report potential text overflow or audio defects as evidence, not unquestionable creative judgments.
- The user's agent performs visual/audio judgment using supported client capabilities. It must report sampled coverage and unavailable modalities. Server extraction and deterministic analysis do not require a new hosted creative model.
- Target less than one minute of additional inspection after output is ready on a documented representative short. Measure artifact preparation and agent inspection separately. This is a target to verify, not an existing performance claim. Rendering and a repair render are separately reported costs in time.
- Permit at most one automatic repair pass for clear defects per review handoff. Do not automatically run further aesthetic iterations. If checks time out or defects remain, return the draft with an incomplete/failed inspection status and actionable findings. These limits are skill workflow policy, not a claim that arbitrary external clients can be prevented from making further ordinary edits.
- Feedback remains in the external conversation. On resumption, reread the project and history; accept human changes as the new baseline. Resolve nonconflicting changes against the latest revision; ask about creative conflicts instead of silently overwriting them.
- Human review references the exact rendered bytes and revision. A newer edit makes an old render stale without deleting it. Provide practical access to prior revision/render evidence and existing restore mechanisms; a side-by-side comparison editor is not required.
- Final human review includes effective script and voice settings alongside rendered output. Retain publication eligibility checks and the permanent publication latch. No delegated publish, human-approval, or destructive command is added in this release.
- Ship a portable skill and client-specific connection guidance. The full flow operates through MCP and scoped artifact access; browser automation of the editing interface is not an acceptance substitute. Human interactive review and approval still happen in Studio.

## Testing Decisions

- Use the authenticated MCP boundary as the principal end-to-end seam: discover/create, edit, render, inspect, and revise a disposable project; assert resulting canonical state and rendered evidence.
- Exercise the existing real database-backed authoring seam for races, immutable history, allowance reservation, idempotency, stale completion, and publication boundaries. These guarantees cannot be established through mocked route tests alone.
- Extend existing OAuth/MCP transport, delegated command, narration/recovery, render lifecycle, and publication regression tests. Test visible outcomes and authority denial rather than matching function names or skill wording.
- Use deterministic fake voice-provider responses for most narration tests; prove repeat requests and visual-only revisions produce no extra provider call. Real paid voice qualification is separately identified and explicitly authorized.
- Use contained renderer fixtures with known cuts, intentional gaps, overflowing text, and audio conditions to validate sampled evidence and timing. Samples do not prove every frame is correct.
- Test unsupported media inspection, expired capabilities, revoked grants, wrong environment, stale revisions, lost responses, duplicate requests, and disconnected clients. Each should produce a useful outcome without widening authority or duplicating side effects.
- Exercise human direct edits and exact-render approval through the existing UI while the MCP client works. Verify old evidence remains identifiable and ineligible for a changed revision.
- Run a real-client qualification for both Claude and Codex with recorded client versions, account/environment, connection steps, supported modalities, timings, and limitations. Generic JSON-RPC probes complement this evidence but do not replace it.
- Any changed review/onboarding UI requires functional browser verification and measured page-load evidence under the repository's frontend rules. Keep heavy inspection generation off editor initialization.

## Out of Scope

- An in-editor timestamped comment system, automatic agent wakeup, or always-running external-agent scheduler.
- Replacing the user's agent conversation with a new embedded chat or model picker.
- A new general-purpose generated-music, image/video-generation, or voice-cloning service.
- Autonomous human approval, publication, destructive project operations, or alterations to publication immutability.
- A new timeline redesign, side-by-side comparison editor, or changes to the designer feedback already shipped.
- A blanket guarantee of frame-by-frame inspection or identical audiovisual capabilities across clients.
- Arbitrary dollar caps, agent-subscription billing integration, or unrestricted repeated paid generation.
- Implementing or deploying the feature as part of this specification-and-ticket task.

## Further Notes

The existing code exposes source/asset discovery, project create/read/history/apply,
and attributed OAuth delegation. It does not currently expose the complete
render/narration/inspection loop. Code presence is not proof of working external
client onboarding or production configuration.

The interview settled product direction. The draft-cycle interpretation and
proposed test boundaries are now explicit for review. Implementation tickets may
refine technical mechanics without silently changing these product constraints.

Forge's file roadmap is the configured tracker. Draft tickets are reviewed before
allocating final global feature IDs and bidirectional dependencies. Existing
completed foundation tickets remain complete; this work extends their policies
rather than reopening them.
