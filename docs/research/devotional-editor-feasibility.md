---
title: Devotional editor feasibility — Mastra configuration, dynamic Remotion, and concurrent editing
date: 2026-09-07
status: researched
roadmap: feat-450
---

# Devotional editor feasibility

Investigation date: 2026-09-07. This note records primary-source research and
inspection of Forge's installed packages. No end-to-end execution, agent mutation,
render, deployment, or paid generation was performed. Recommendations below are
proposals, not implemented behavior.

The intended product has an app-owned Mastra agent and an external Claude Code
client using MCP. Both edit the same devotional project. The user wants an owned
editor UI, editable monitored system instructions, and new Remotion code when
existing components cannot express a design. The research question is which
capabilities can be reused without inventing another prompt database or requiring
an application deployment for every generated visual.

## Findings

**Mastra already supports the requested editable instruction storage.** Forge can
build its own UI over native Editor operations, with Mastra's configured Postgres
storage owning drafts and versions. **Remotion supports dynamic generated
components**, including a fixed runtime receiving source code as input. Neither
capability supplies Forge's product authorization, publication semantics, or
complete editing model automatically. CRDT synchronization is a separate decision
from prompt storage and agent configuration.

## Mastra: native configuration, storage, and versions

The current [Editor documentation](https://mastra.ai/docs/studio/editor) describes
code-defined agents whose instructions and tools can be changed without modifying
source. Database storage is the default: save a draft, test it, then publish. The
developer retains control over identity, model, and runtime. This directly fits an
app-owned agent with an editable system prompt; prompts are not limited to source
files.

Forge already installs `@mastra/core` **1.55.0**, `@mastra/editor` **0.13.9**,
`@mastra/pg` **1.18.1**, and CLI `mastra` **1.21.0** in
[apps/mastra/package.json](../../apps/mastra/package.json).
[Runtime configuration](../../apps/mastra/src/mastra/index.ts) registers
`new MastraEditor()` and a `MastraCompositeStore` whose default store is
`PostgresStore` using schema `mastra`; observability is routed separately to
DuckDB. Inspection of installed `@mastra/pg` confirms `AgentsPG`, `PromptBlocksPG`,
and `ScorerDefinitionsPG` storage domains. This is existing dependency support,
not a proposal requiring a major version upgrade. Actual database readiness and
authorized API operation were not exercised.

The native [MastraEditor API](https://mastra.ai/reference/editor/mastra-editor)
provides `agent` and `prompt` namespaces with create, get, update, list, delete,
and cache operations. The installed editor declarations confirm these methods and
`applyStoredOverrides` with draft, published, or explicit version selection.
Server endpoints expose the same configuration operations under `/api/stored/agents`.
An owned UI can call an authenticated application adapter rather than storing
instruction bodies in a second Forge table.

The [Client SDK reference](https://mastra.ai/reference/client-js/agents) documents
stored-agent creation/update and version listing, comparison, activation, and
restoration. It also documents selecting draft or a specific `versionId`.
Treat these as current API capabilities, not proof that an SDK dependency is
already installed in the future editor app; select its version alongside Forge's
server and verify request contracts before implementation. Latest documentation
contains other newer features that this investigation did not compatibility-test.

[Prompt blocks](https://mastra.ai/reference/editor/prompt-blocks) are independently
versioned reusable instruction text. They support template variables and display
conditions derived from request context. References ordinarily resolve the active
published block; draft preview is separate. Consequently, pinning an agent version
alone should not be assumed to freeze every referenced block forever. Record the
effective instruction identities/content digest for a generation attempt. Native
draft/published activation is supported; do not assume a Langfuse-style arbitrary
label system from these APIs.

There are two products to distinguish. **Editor** modifies code-defined agent
configuration. **Agent Builder** creates/manages fully stored agents in its own
browser application. The [Agent Builder prerequisites](https://agent-builder.mastra.ai/)
require a production Enterprise Edition license and a registered builder agent
from `@mastra/editor/ee`. Installed editor source contains the corresponding
Builder license guard. The user's owned instructions UI does not, by itself,
require deploying that full Builder product. Check applicable licensing if the
scope expands to those features; do not conflate the two surfaces.

### Monitoring and the existing alternatives

Mastra's [evaluation APIs](https://mastra.ai/docs/evals/overview) support automated
scorers, live sampling, and persisted results. Forge already has native evaluation
integration in
[offline-search-eval/native-evaluation.ts](../../apps/mastra/src/services/offline-search-eval/native-evaluation.ts).
These are mechanisms to reuse, not a devotional quality suite. Define examples
and failure criteria for source fidelity, editorial voice, scripture accuracy,
and output structure before treating a prompt version as releasable. Live
asynchronous scores are monitoring, not automatically a blocking approval gate.

Forge also has
[Langfuse prompt retrieval](../../apps/mastra/src/services/langfuse-prompt-client.ts),
including exact version/hash verification, and
[Seeker's pinned resolution](../../apps/mastra/src/mastra/agents/seeker-agent.ts).
Existing devotional agents instead use
[Workspace instruction resolution](../../apps/mastra/src/mastra/agents/devotional/instruction-resolver.ts).
Native Editor is the closest match to configuring Mastra agents in an owned UI.
Choose one instruction authority for the new workflow; do not let Workspace,
Langfuse, and Editor silently override each other. Existing tracing can remain
useful independently of which system owns the instructions.

## Remotion: generated code without per-design app deployments

Remotion's official
[dynamic compilation guide](https://www.remotion.dev/docs/ai/dynamic-compilation)
demonstrates generated TSX compiled with Babel and executed as a React component
in Player. The guide explicitly states that this executes code with browser
globals; production iframe isolation and CSP are outside the example's scope.
It proves feasibility, not a ready-made secure hosted execution service.

The official
[AI SaaS template](https://www.remotion.dev/docs/ai/ai-saas-template) includes
streamed generation, edits, compilation-error correction, and live preview.
Its [DynamicComp source](https://github.com/remotion-dev/template-prompt-to-motion-graphics-saas/blob/main/src/remotion/DynamicComp.tsx)
reads source from input props and compiles it. Its
[render route](https://github.com/remotion-dev/template-prompt-to-motion-graphics-saas/blob/main/src/app/api/lambda/render/route.ts)
passes those props to a fixed deployed composition. Thus a generic runtime can be
deployed once and accept generated components as versioned data. A separate app
deployment per design is not inherent to Remotion.

Lambda is optional. Remotion documents [bundling and reusing input props](https://www.remotion.dev/docs/bundle),
and its [Editor Starter FAQ](https://www.remotion.dev/docs/editor-starter/faq)
allows rendering on a long-running server. Forge can keep its worker architecture
instead of adopting the template's cloud provider.

Forge currently pins Remotion **4.0.475** in
[shorts-compositions/package.json](../../packages/shorts-compositions/package.json).
Its [worker](../../apps/shorts-worker/src/devotional-render.ts) uses a known code
entrypoint or a prebuilt deployment bundle. The
[composition schema](../../packages/shorts-compositions/src/devotional/schema.ts)
accepts semantic cards, timing and media props. No current path was found that
accepts arbitrary user-generated component source. The official dynamic pattern
still needs integration and runtime testing against the pinned packages.

**Recommendation:** retain a normal timeline/project document and permit a
generated component to declare its editable props, duration and asset references.
Store its source and immutable version with the project. Arbitrary React does not
automatically become draggable timeline items or expose understandable property
controls; the [Starter FAQ](https://www.remotion.dev/docs/editor-starter/faq)
distinguishes its JSON-based editor from arbitrary React compositions. This
integration model preserves rich visuals without pretending source code is a
complete editor state model.

Before hosted execution, prove preview/export agreement, allowed dependencies,
asset access, timeouts, network restrictions and containment of generated code.
These are required engineering questions for the selected capability, not evidence
that Forge already has a sandbox. Keep code versions and rendering dependencies
attached to outputs so a later edit cannot change the meaning of an approval.

## Concurrent browser, MCP, and hosted-agent edits

The user's “CRT” may mean **CRDT**; confirm terminology. Automerge describes
[replicas and eventual convergence](https://automerge.org/docs/hello/), but
[same-property conflicts](https://automerge.org/docs/reference/documents/conflicts/)
still require semantics: a deterministic winning value is not necessarily the
editorially correct outcome. Its
[list guidance](https://automerge.org/docs/reference/documents/lists/) favors
fine-grained edits because replacing whole objects defeats useful merging.

For example, Lyuba can change narration while an agent adjusts card duration.
Both edits may merge cleanly while the new speech no longer fits. CRDTs cannot
decide whether linked timing should move or a locked card should reject the edit.

**Recommendation for the first implementation:** expose revision-aware commands
shared by browser, MCP and Mastra. A client reads revision 42 and submits an edit
expecting 42. A stale command must re-read/rebase or present a conflict rather
than overwrite newer work. This already has a Forge precedent in
[Admin MCP's expectedDraftRevision](../../apps/admin/src/mcp/admin-mcp-tools.ts)
and the transactional checks in
[ExperienceService](../../apps/admin/src/services/experience.service.ts).
Real-time notifications can distribute accepted changes independently of CRDTs.

Attach composition revision, effective instruction versions and asset dependency
identities to generation/render jobs. Stage or reject stale results instead of
silently applying them to a changed project. Consider CRDTs later for simultaneous
fine-grained text/timeline editing if that experience requires them; they are not
needed merely to obtain native prompt versioning.

## Decisions and verification still needed

1. Confirm native Editor as the new agent's instruction authority and decide who
   may publish instruction changes. Exercise draft, preview, activation and
   rollback through the actual gateway and Postgres setup.
2. Define the generated-component contract and isolated runtime, then prove one
   dynamic component previews and exports identically without an app redeploy.
3. Define stale-edit, timing-lock and stale-generation behavior shared by all
   clients; test concurrent narrative and timing changes before adding CRDTs.

This research supports an owned editor over existing Mastra configuration
storage and Remotion primitives. It does not attest to release readiness or
authorize implementation, prompt publication, paid generation or deployment.
