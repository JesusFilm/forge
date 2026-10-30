> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Independent review

Fixed implementation base: `65836fc0fb85dad733a3de84792e3d4731a968aa`.
Reviewed `git diff --cached 65836fc0`, including all new files; implementation
commits had not yet been created. Separate Standards and Spec reviewers used
root/package guides and the feat-456 ticket, authoring plan, brief and runtime proof.

## Standards

Initial findings: handwritten materialization GraphQL operation and raw Error
throws. Replaced them with `adminGraphql`/`print` and domain error classes.
Follow-up caught two upload-route raw errors, also replaced. Suggested cleanup
removed project-list N+1 reads with canonical batched revision summaries and
consolidated edit/undo/redo dirty-state transitions. Broker orchestration remains
together to own one cancellation, transfer budget and cleanup lifetime; the
reviewer accepted this rationale.

Final independent result: **clear; no remaining actionable standards findings**.

## Spec

Initial findings: deleting a broken custom item still compiled its unused code;
active previews expired without renewal. Stage/compile now include only active
component versions. Authenticated renewal extends live sessions every five
minutes and on visibility return; a failed renewal restages the current document.
Fifteen-minute expiry still cleans up abandoned sessions.

Follow-up found that active component references also had to participate in the
preparation signature, otherwise Undo/history could restore an item without its
code. The signature now filters to active definitions, with regression coverage
for deletion/restoration versus live property updates.

Final independent result: **clear; no remaining actionable spec findings**.
Browser verification and final build/check results are recorded separately.

Final findings: Standards 0; Spec 0.
