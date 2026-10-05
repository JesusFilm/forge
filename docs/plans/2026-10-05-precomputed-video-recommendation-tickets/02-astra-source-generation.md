---
date: 2026-10-05
draft_id: "02"
title: "Generate explainable source recommendations with Astra"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2567
roadmap: feat-590
draft_blocked_by: ["01"]
---

# 02: Generate explainable source recommendations with Astra

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Replace the fixture producer for a selected source with an authenticated Mastra
generation entry point using GPT-6 Astra. Read canonical catalog content from
Admin, discover candidates across the eligible catalog, validate the model's
decisions, and inspect the saved result in the existing private Admin comparison.

This is the bounded source-generation path; full catalog coordination comes in
a later ticket. Content-only fixture runs are explicitly identified and are not
reported as the required historical-analytics first build.

## Acceptance criteria

- [ ] The configured application model is gpt-6-astra. Missing project access is reported explicitly; there is no silent model substitution.
- [ ] The source workflow examines transcripts and metadata, discovers beyond incumbent candidates, and uses available non-English transcripts while producing English explanations.
- [ ] The model chooses relationship type and ordering per source, may return variable counts, and produces explainable broader alternatives. It is not instructed to stop at six accepted edges.
- [ ] Supporting passages are validated against the source evidence; metadata-only judgments remain visibly distinct. Source/target identity and duplicate/Dub exclusions use the contracts introduced by the preview slice.
- [ ] A directed recommendation does not create an implicit reverse recommendation. Chapters and parent films require added viewing value.
- [ ] The saved generation records input cutoff, evidence/provenance, model/prompt versions, usage, and explicit source completion or failure. Failed/partial output cannot replace a complete generation.
- [ ] Transcript/metadata content cannot grant tools or activation authority. Prompts, credentials, and raw transcripts are not copied into general logs or every checkpoint.
- [ ] Provider-contract and build-to-review tests use controlled model outputs and real Admin persistence. Cases include malformed output, invented evidence, missing transcript, sparse choices, and retry behavior.
- [ ] With authorized provider access, an optional small live smoke can be run and recorded separately; fixture tests never claim live model quality or cost. No public serving or recurring schedule is activated.

## Implementation context

Follow existing offline Mastra content-generation and Admin-ingest ownership.
Use bounded provider calls and explicit errors without imposing a new total
user spending ceiling. Public request handlers must have no dependency on this
runtime. Historical warehouse inputs are added by the next input slice.

## Blocked by

- #2566

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
