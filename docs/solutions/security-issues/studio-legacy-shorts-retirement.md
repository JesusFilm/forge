---
module: Studio legacy retirement
problem_type: integration_issue
tags: [studio, shorts, retirement, devotional, worker]
---

# Retire legacy authoring without deleting shared media execution

`/dashboard/shorts` already served the Admin-backed Studio editor. Removing the
unused legacy React screens alone left `/api/shorts` and worker prepare/render
admission available. Retire the exclusive API, workflow, client and caption/draft
helpers together, and verify old job kinds are rejected before reserving capacity.

The worker's `devotional-render.ts` imported its Remotion engine from legacy
`render.ts`. Move the unchanged lazy adapter into `render-engine.ts` before removing
the old pipeline. Keep devotional queue, dedupe, cancellation, signed transfer,
source checks and browser teardown. The explicit devotional snippet CLI still uses
`@remotion/install-whisper-cpp`; remove service model provisioning, not that shared
dependency. Historical Manager options/step names also survive because generic
read/filter and artifact identity code still uses them. These are existing consumers,
not a new archive or compatibility workflow.

A reduced worker image still needs transitive workspace dependencies. Include
`studio-contracts` beside `shorts-compositions` in dependency installation, source
copies, runtime symlinks and deploy watch paths. Node source TypeScript must remain
outside materialized node_modules paths. Prebundle the retained devotional entry;
keep its fonts and aspect-specific composition code.

Validation: `docs/validation/studio-462-retirement/README.md`. This local retirement
slice leaves feat-462 in progress. Host build/prebundle/HTTP checks are not exact
OCI image or Railway proof. No original assets or stored rows/bytes were deleted,
no paid batch reopened, and no provider or deployment operation occurred.
