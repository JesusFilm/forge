# Generation-read original-command isolation

Fixed base: `779eb26e706919780b9b5956b1337d0038678aaf` (root integrated equivalent `999b81e95351afb01184a941f6f150b165b8aeca`). Approved proposal SHA256 `d76e66c8f9a227c077ba1937cdec213ddfb5b8974201bcc2901006836683c029` is retained unchanged in `approved-proposal.body`.

The only product change is `structuredClone(proposal.command.operations)` at `StudioGenerationService.read`'s projection call. The original response command remains untouched while the final document retains existing ordered semantics. Core `applyOperations`, validation, schema/tool bytes, prompts, hashes and provider state do not change.

## Red/green and retained provenance

`generation.read.test.ts` exercises the actual service with mocked database/storage/source boundaries. Its original-SSE case uses the already retained `effective-speech-feedback/slot0-original-proposal.json` and compares the result with `model-comparison-1/live/retained-0.body`'s canonical document. Expected original operations digest: `351ad0cd6eea7b22f0423cc2cda48cd6436daefefd14e2dc1b961f4c4d6fcd7f`.

`red.log` fails exact returned-command equality before the fix. `green.log` passes after the one-line boundary change. `expanded.log` records three passing tests: original digest/whitespace and final document; nested inserted-item changes, opposite speech/text order, selected/repeated reads; and authority, actual manifest-byte digest verification, project/revision binding and source-error propagation. The source rejection is injected at the source-resolver boundary, not claimed as a new real-video eligibility proof.

Before the fix the original 582/317/43-character speech operations became 219/140/43 in the response, including same-length whitespace changes. Stored original manifest/SSE bytes were not modified. The historical preview command remains honestly labeled aliased; the retained canonical document is final-result evidence. Nothing repairs closed output in place.

The clone covers the whole selected operations array because speech-only cloning would miss inserted-item aliases. It does not add partial projections or modify operation order. The evaluator still creates the same final document.

## Real Postgres and validation

The existing owned-Postgres retained-generation test now adds ordered speech/text operations to its retained proposal, checks exact original command in repeated reads, and confirms registered manifest bytes, attempt row and current project revision remain unchanged. It reuses the existing stale-result scenario and its pre-existing setup/apply/approval fixture operations; no new Apply call was added. No provider is called. This is local deterministic storage/orchestration evidence, not creative/audio acceptance.

- Focused Admin: 22 passed, including 19 existing/extended real-PG tests and 3 new service-boundary tests.
- Admin typecheck and production build passed (`types.log`, `build.log`). Restored build identity is recorded in `restored-service.json`.
- Full Admin: 6200 passed, 10 failed, 85 skipped, 1 todo (426 files). All ten failures belong to five environment-default/auth/Redis files: the isolated runtime wrapper supplied a fixture cookie prefix/database URL and reachable task-local Redis where those tests expected standard defaults or absent Redis.
- The exact five files rerun with a clean test environment and network isolation: 82 passed. No assertions, production environment values or shared Redis were altered to make them pass. The original full failure is retained, not relabeled as an entirely green full run.
- Independent fixed-base Standards and Spec reviews: no findings; reports retained. They inspected source/assertions without running providers or services.

## Unchanged limits and services

All 680 prior evidence entries verified unchanged before append. All paid batches remain closed, and full creative/ElevenLabs acceptance remains incomplete. The earlier bounded interleaved loading comparison remains **inconclusive**: cold slowdown not reproduced, overlapping warm distributions with a +24 ms final median and CPU differences. This server-only response provenance fix makes no frontend performance pass claim and performs no additional timing repetitions.

Only the owned Admin process on 3587 was stopped for its affected build to avoid serving mixed build artifacts; the same isolated built route is restored afterward. Other owned/shared services, Manager build and opaque preview permissions remain unchanged. Scratch uses the workspace filesystem; the scarce `/tmp` baseline and historical fixtures are retained. No account, infrastructure, provider, prompt or publication action occurred.
