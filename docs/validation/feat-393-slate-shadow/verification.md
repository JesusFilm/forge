# Slate composition shadow verification

Branch: `codex/recommendation-slate-shadow-quality`, based on `origin/main` at `3cc4017af`.

## Implemented

- Deterministic row-only theme similarity penalty and source/interest coverage bonuses, versioned `source-interest-theme-mmr-shadow-v1`.
- Existing eligibility and canonical union remain authoritative; bounds are 64 candidates and six positions.
- Pure composer preserves explicit fixed editorial order, pins and approved pools; unavailable constraints fail closed. Known recent history uses a fresh-first preference and bounded deterministic refill. Immediate exits are not consumed.
- Existing shadow projection additionally records pre/post composition evidence and an explicitly pending independent decision. Existing live and candidate-shadow orders/decisions remain separate.
- Existing retained shadow nominations carry bounded scalar composition provenance under the unchanged 2048-byte PostgreSQL guard. Request expiry, cascade deletion and profile-generation fences remain the existing owners.
- Admin's authorized request-detail reader projects only named scalars. A server-rendered disclosure explains item rank, composition position, reasons, scores, coverage and missing inputs.
- Corrected canonical nomination inspection when the first canonical representative is ineligible and a valid variant is selected.

## Checks

- 78 passing tests across 11 affected files, including nine actual PostgreSQL migration/constraint tests in a uniquely owned schema on the parent task's disposable test DB.
- The PostgreSQL test stores real shadow projection output with long multibyte source provenance, checks the 2048-byte bound, executes the actual Admin composition provenance SQL, and retains immutable decision/root-expiry/cascade checks.
- Full Admin `typecheck` passed.
- Focused ESLint and normal commit-hook lint-staged passed.
- Repository-wide `prettier --check .` passed.
- Desktop 1280x900 and mobile 390x844 component screenshots: no browser errors, no document horizontal overflow, 64 rows, no resource requests.

## Synthetic component performance

See `performance.json`, measured over 1000 warmed executions, 64 eligible candidates / 64 nominations:

- Composer median 0.851ms, p95 1.051ms.
- Prior-history render (no comparison) median 0.021ms, p95 0.035ms.
- Comparison render median 1.451ms, p95 2.650ms.
- Comparison HTML: 17,918 bytes. No new client component, playback code or network dependency.

This is synthetic component render/cost evidence, not a production request-latency claim or full authenticated route/browser test. Screenshots and fixture HTML contain only generated fixture IDs and themes. No production queries were made for this work.

## Remaining feat-393 gates

The ticket remains in progress. The published editorial adapter (feat-388) is absent; current shadow generators do not capture historical/ignore context. Series/speaker inputs and familiar/discovery calibration remain unavailable. Current comparison rows visibly mark recent history unavailable and editorial adapter pending. The weights are an unevaluated hypothesis, and a separate terminal composition decision is required before controlled exposure. No promotion, experiment activation, push, PR or production change occurred.
