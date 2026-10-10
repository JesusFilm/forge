---
date: 2026-04-08T00:00:00.000Z
topic: manager-upload-publishing-studio
---

# AI Uploading and Publishing Studio for Manager App

## Problem Frame

The current manager flow treats upload, enrichment, editing, and publishing as separate tasks. That is workable for technical operators, but it is too fragmented for high-volume video intake or fast editorial iteration. A stronger next step is a single studio flow where a person drops in source media, lets the model propose structure and metadata, edits the result visually, and then pushes it to downstream destinations with explicit approval.

## Requirements

- R1. Add a unified "New Video" studio in the manager app for upload, enrichment setup, editing, and publishing.
- R2. Users can start from a file upload, an external URL, or an existing Mux asset.
- R3. The studio automatically proposes title, description, topics, chapters, target languages, caption strategy, and voiceover options before the user approves the plan.
- R4. A WYSIWYG page editor lets the operator review and adjust the generated video page experience before publishing.
- R5. Publishing destinations include internal Mux-backed delivery plus optional YouTube upload handled through a browser-agent workflow.
- R6. The studio shows stage-by-stage progress and keeps every publish action explicit and reversible until final approval.
- R7. The same flow works for first-time uploads and for reworking an existing video into a better page/output package.

## Success Criteria

- An operator can go from raw asset to publish-ready package without stitching together multiple screens and manual side notes.
- AI suggestions reduce setup time while preserving human approval at the publish boundary.
- External publishing to YouTube becomes a routine last-mile action instead of an off-platform manual process.

## Scope Boundaries

- Not a replacement for the full CMS admin.
- Not autonomous publishing without review.
- Not a general multichannel marketing system.

## Key Decisions

- Upload, edit, and publish are treated as one studio because the value is in removing handoff friction.
- The model is allowed to steer recommendations, but never to publish unapproved content.
- Browser-agent publishing is intentionally limited to last-mile platform automation such as YouTube.

## Dependencies / Assumptions

- Existing job creation and enrichment APIs remain the execution backbone for first-pass studio orchestration.
- The manager app can host a visual editor that focuses on the video page package without recreating every Strapi capability.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Should the first WYSIWYG editor edit a manager-owned draft document, or generate Strapi-compatible block data directly?
- [Affects R5][Technical] Should YouTube publishing happen synchronously in the studio flow, or via an auditable async publish job?

## Next Steps

-> `/ce:plan` for structured implementation planning
