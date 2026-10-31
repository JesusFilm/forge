# Studio autosave and expired-session regression

This fixture mounts the real Studio editor, session, inspector, timeline and lazy
Remotion Player. Next link/dynamic wrappers and HTTP transport are substituted.
The project contains a caption and an ending audio item; media descriptors are
empty so no external media or production data is fetched. No credentials are used.

## Run

```sh
pnpm install --frozen-lockfile --filter @forge/manager...
npm install --prefix .tmp/browser-tools --no-package-lock playwright@1.61.1
node docs/validation/studio-autosave/serve.mjs
# In another terminal; Chrome defaults to /usr/bin/google-chrome:
node docs/validation/studio-autosave/check.mjs
```

Seven browser scenarios pass: audio deletion saves and reopens without Save;
autosave HTTP 401 retains subsequent edits and supports sign-in/retry; preview
HTTP 401 reaches the parent warning before any apply; links and reload warn;
recovery preserves the deletion; same-document browser Back can be canceled;
edits made during a delayed save persist in order; a remote revision conflicts
without being overwritten. The sign-in link opens a separate tab. Native
beforeunload text is controlled by the browser.

The Navigation API traversal guard is exercised in Chrome. Browsers without a
cancelable Navigation API still warn for links and document unload, but this
change does not intercept their App Router same-document Back/Forward. Recovery
remains in session storage, subject to browser storage availability.

## Baseline and performance

The baseline is commit `38607518d`, unchanged before this task. Export its Manager,
contracts and composition sources and link installed dependencies:

```sh
mkdir -p .tmp/studio-autosave-baseline
git archive 38607518d apps/manager/src packages/shorts-compositions/src packages/studio-contracts/src | tar -x -C .tmp/studio-autosave-baseline
ln -s "$PWD/apps/manager/node_modules" .tmp/studio-autosave-baseline/apps/manager/node_modules
ln -s "$PWD/packages/shorts-compositions/node_modules" .tmp/studio-autosave-baseline/packages/shorts-compositions/node_modules
ln -s "$PWD/packages/studio-contracts/node_modules" .tmp/studio-autosave-baseline/packages/studio-contracts/node_modules
STUDIO_QA_PORT=4181 STUDIO_QA_SOURCE_ROOT="$PWD/.tmp/studio-autosave-baseline" node docs/validation/studio-autosave/serve.mjs
# Baseline intentionally fails waiting for revision 2 after deleting audio:
node docs/validation/studio-autosave/check.mjs http://127.0.0.1:4181
# With both servers running:
node docs/validation/studio-autosave/performance.mjs
```

Performance alternates six fresh Chrome contexts per version at 1440x1000.
Measure DOMContentLoaded, lazy preview readiness, script transfers and initial
apply/preview counts. These are local development fixture measurements, not
production Web Vitals or decoded-video timing. Repeat medians (baseline/candidate): DOMContentLoaded 559.6/579.2ms,
preview readiness 1105.7/1111.0ms, script transfer
5,710,249/5,655,728 bytes. Raw evidence is in
`performance-results.json`. The earlier concurrent-build/lint busy-host run is
retained in `performance-busy-host.json`: readiness was 2216.6/2783.0ms while DCL
was 1239.2/971.9ms. Timing is noisy on this shared host; neither run establishes
production performance. The repeat shows no material regression, and both runs
have zero initial saves and one initial preview request per context. No additional initial save or preview request occurs;
Player remains behind the existing lazy import.

## Validation

- 35 focused Studio tests pass, including six new autosave cases and the
  expired-session warning regression.
- Manager type checking, full lint with zero warnings, production build and
  changed-file formatting pass.
- The warning test initially failed: HTTP 401 returned only a generic save error.
  Baseline browser deletion stayed at revision 1. Candidate checks pass.
- No production project was edited, no export/provider call was submitted, and
  no direct deployment or Slack reply was made.
