# Studio video authoring — consolidated design brief

Created: 2026-09-07

Status: confirmed by user; ready for implementation planning

Product owner for initial operation: Lyuba

Related design ticket: `feat-451`

Research: [Editor feasibility](../research/devotional-editor-feasibility.md)

Implementation plan: [Studio video authoring](../plans/2026-09-07-001-feat-studio-video-authoring-plan.md)

## Purpose and product location

Replace Shorts inside Vlad's Studio product, implemented in `apps/manager`.
The user reports no existing Shorts content to preserve and explicitly chose
complete replacement without migration or an archive. This is design scope,
not a record of any data deletion or deployment performed.

The first operator is Lyuba, with full control. Her latest local devotional
pipeline supplies the initial creative behavior and QA learnings. Preserve
those learnings while moving authoring, generation, assets, and rendering into
the hosted product. Earlier render-first Workspace workflows are potential
sources of reusable infrastructure, not the target product design.

Standalone projects are first-class and will be the initial test path.
Calendar assignment is optional. The editor is content-agnostic; devotionals
are an initial agent-directed use case rather than an enforced arrangement.

## Authoring and agents

Provide an NLE-style editor, informed by Remotion's Editor Starter: live
composition playback, an editable canvas and timeline, video/audio/text controls,
trimming, cropping, and undo/history. Card-oriented inspection remains useful
for checking text and layout without playing the entire video.

The application has its own Mastra agent, so Lyuba does not need local AI to
operate it. External Claude Code can also interact with the same service through
MCP. Both clients and manual UI operations act on the same project model and
revision-checked operations, with no separate publication path for agents.

Support dynamic, agent-generated Remotion components. A generic runtime can
compile and preview versioned source without a new app deployment per design.
Custom components need declared editable properties, duration, and asset
references to participate meaningfully in the NLE. Arbitrary React is not
automatically decomposable into individually editable canvas elements.

Generated code execution requires an isolated preview/render design. Official
examples establish feasibility; the current Forge worker does not already
provide this capability. Prove preview/export agreement and failure containment
before exposing it to the operator.

## Content Packs and planning

**Content Pack** is the accepted term for a reusable set of source material and
editorial guidance used to plan or generate content. Do not call it a Source
Collection, which conflicts with existing system vocabulary, or a Preacher Pack,
which is too narrow.

Source material drives themes; the system does not impose a fixed commentary
corpus or devotional arrangement. A pack may include sermons, transcripts,
Scripture, articles, and guidance. Distinguish evidence/source material from
instructions. Retain which pack version and actual source passages informed
generated work.

Lyuba can assign a pack to a week or individual calendar slot. Without an
assignment, the planning agent can choose from a configurable default set and
show its choice. Her instructions and overrides take precedence.

The initial calendar plans one item per day across the next fortnight, with
advance planning for the following fortnight. Automated planning may run once
or twice daily. It creates **titles and themes only**, including weekly themes;
it does not autonomously generate scripts, narration, or media in either horizon.

Lyuba can initiate production through the UI or an agent, for a project or a
batch. Broad changes to calendar direction apply to planning entries and
untouched drafts. Edited or approved work is identified and preserved unless
she explicitly includes it in the change. Prior draft work remains recoverable.

## Generation and review

When production is requested, prepare the script, cards/layout, selected footage,
and trimmed preview before paid narration. Lyuba reviews the script, then requests
or approves narration generation. Pacing is reviewed with actual generated audio;
silent preview is useful for layout but cannot establish final spoken timing.

Text, narration, and card duration are linked by default. Regenerating an edited
segment adjusts its duration and shifts following linked content. Explicit
manual timing locks are respected: conflicts are surfaced rather than truncating
speech or silently discarding manual choices.

Use revision checks for simultaneous browser/MCP/Mastra changes. Stale changes
must be reconciled instead of overwriting newer work. Attach input revisions to
generation jobs so an old result cannot replace a newer edit. CRDT collaboration
is not required for the initial implementation.

## Agent instructions

Use native Mastra Editor APIs and Mastra-managed persistence for editable agent
instructions and their versions. Build the relevant UI rather than a separate
prompt database. Support inspecting, editing, testing, comparing, activating,
and restoring instruction versions; retain effective instruction identities
with generation attempts.

Lyuba's writing preferences live in configurable agent instructions and review
criteria. The initial instructions can preserve her established format while
allowing the agent to change content arrangements. Lyuba has full control.
System access rules, asset integrity, and publication invariants remain product
controls, not editable prose instructions.

## Forge media and shared assets

Source footage comes from the Forge library, using its API and Mux media.
Use the selected dub's language and the correct video edition's timed subtitles
or transcript for source selection and cutting. Do not silently substitute another
audio language or independently generate replacement captions in the authoring
pipeline. Missing eligible audio/subtitles should cause alternate source selection
or a reviewable blocked item.

Retain exact source-video, dub/edition, track, and source-range relationships.
Subtitles suggest sentence boundaries; the operator can preserve pauses and
adjust clip endings. Preserve the mapping between source and composition timing.

Use streaming media for interactive preview and an appropriate high-quality
source for export. Verify the actual Remotion/Mux track-selection behavior;
adaptive lightweight preview is not automatic merely because a URL is HLS.

Provide shared music, backgrounds, voice presets, reusable spoken phrases, and
generated narration assets. Select from approved shared assets freely. New music
or voice experimentation is an explicit creative action, with estimated cost and
retained candidates. Reuse matching narration while preserving recording metadata,
including spoken text, provider/model, voice settings, and usage references.

Keep all assets at this early stage; no automatic retention/deletion policy is
part of this release. Reuse existing media infrastructure where suitable. Actual
storage integration must account for audio semantics and provenance that the
existing generic media library does not yet expose.

## Publication and release

Everything is changeable until actual publication. Approval/rendering ahead of
a calendar date does not make the project permanently immutable. A subsequent
edit invalidates stale approval/render output; only the matching approved version
can publish. Recheck that relationship at the publication boundary.

Once published, the item is permanently immutable. **Unpublishing is the only
post-publication content-management action.** There is no correction, replacement,
or corrective-copy workflow. Unpublishing does not restore editability. Earlier
interview suggestions to edit or duplicate a published devotional were rejected.

The output becomes a Forge library video with its generation/source metadata and
relationships to footage it contains. The release demonstrates a complete path
through generation, review, rendering, Forge registration, and scheduled Watch
visibility. Mobile can consume the shared catalog later; a mobile UI change is
not required for the first release. Social distribution starts with downloads.

Only the author-created language is required; translation is deferred.
An unapproved, blocked, or failed item stays unpublished when its date arrives.
Do not substitute or force content through automatically.

## Engineering investigations for implementation planning

These are unresolved implementation tasks, not permission to change the agreed
product decisions:

1. Recover Lyuba's complete branch ancestry and paid assets; the attached patch
   is not self-contained against this checkout. Use examples to verify creative
   behavior and preserve known fixes.
2. Define a durable project model separate from Manager render jobs; old Shorts
   draft persistence is last-write-wins and has no catalog publication contract.
3. Define dynamic-component persistence, dependency isolation, editable controls,
   and preview/export parity. Account for Studio page-load performance.
4. Exercise native Mastra draft/test/publish/restore against the actual backend;
   choose it as the new workflow's instruction authority without silently
   competing with existing Workspace or Langfuse instruction paths.
5. Integrate exact-language media/edition/subtitle selection, shared audio metadata,
   and a Forge catalog ingest path that records derivation rather than treating
   ordinary parent/child browsing links as sufficient provenance.
6. Implement publication scheduling with explicit timezone/time configuration,
   revision checks, job recovery, and immutable post-publication behavior.
7. Prove the standalone authoring path first, then the calendar and Watch release
   path. No production deploy, application implementation, or paid generation
   has occurred during this interview.
