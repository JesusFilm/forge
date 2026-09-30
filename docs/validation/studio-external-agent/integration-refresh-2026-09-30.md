# Integration refresh — September 30, 2026

PR #2405 was refreshed from its qualified `b24e6aced` head onto main
`8b72e153a`. The two merge conflicts were additive schema declarations and the
patched-dependency map. Both sets of Prisma models remain. The dependency map
uses main's Next 16.3.6 patch and the unchanged Remotion 4.0.475 patch. Frozen
dependency installation and Prisma/Pothos client generation succeeded.

Main allocated four previously unpublished Shorts roadmap IDs while this PR was
open. The following mapping applies to current plans, tickets and dependencies;
historical worktree/branch names and September 23 evidence retain their original
identities. Unrelated main tickets were not renamed or modified.

| Shorts ticket      | Original ID | Current ID |
| ------------------ | ----------- | ---------- |
| Approved planning  | feat-541    | feat-583   |
| Render a draft     | feat-543    | feat-584   |
| Bounded narration  | feat-544    | feat-585   |
| Sampled inspection | feat-545    | feat-586   |

Connect/edit remains feat-542, human review feat-546, portable skill feat-547,
qualification feat-548 and the historical retention audit feat-549. Dependencies
remain bidirectional and preserve the approved seven-ticket graph.

The unpublished Shorts migration directories now append after main's 0120.
Their SQL bytes are unchanged:

| Migration                       | Original prefix | Current prefix | SQL SHA-256                                                      |
| ------------------------------- | --------------- | -------------- | ---------------------------------------------------------------- |
| studio_render_retention_profile | 0099            | 0121           | fd09930b590010e55607ce7a89b6809bab5b78c864616a5928bedb3d38d592a8 |
| studio_delegated_narration      | 0100            | 0122           | 276406516978e09392c8f65a995648c430ace796426effd05f2b7ff4d30c603c |
| studio_render_preparation       | 0101            | 0123           | fb881f2699bcfaf66e9bfcbc53842e1a2ce1fbe93bc09a4336152336657607d4 |
| studio_render_inspection        | 0102            | 0124           | e1a6b0b88f0afb5122432b19e2d1599bd27b1942fae0b44702e75d7d84c7051c |

A fresh task-owned PostgreSQL 18 cluster on loopback port 55460 applied the full
sequence through 0124 successfully. Historical task databases were preserved;
the renamed CREATE migrations were not applied over their old migration ledgers.
Neither a deployed database nor production configuration was changed.

Admin and Manager typechecks passed. Admin SDL and admin-graphql introspection
were regenerated and match current main without drift. Focused Manager tests
passed (32 plus the separately enabled real-codec inspection test), all 43 Studio
contract tests passed, and four installed-renderer codec/browser regressions
passed. Ten authoring/delegation/render/narration tests passed on the fresh
regression database; the production-storage narration recovery test passed on
its separately allowlisted fresh database. Initial invocations without the
required fixture flag or with that test's wrong database name failed closed;
the guard checks were preserved.

The portable archive still matches source at 28,788 bytes. A repeated initial
projects-page SSR measurement used 100 warmups and 500 alternating samples:
636/740 markup bytes, 395/450 gzip bytes, and 0.454/0.476 ms median baseline/current
render time. The download link introduces no initial fetch. This is a component
loading measurement, not authenticated navigation or a production latency claim.

The Manager production build passed on Next 16.3.6. Native renderer compilation
and both qualification-launcher network-isolation guard tests also passed.

The normal merge hook exposed a root/package lint mismatch after the Next
upgrade. Manager and Web already use the new relative-navigation lint rule, but
root lint-staged lacked that rule and its browser globals, making the existing
intentional navigation suppressions appear unused. A narrowly scoped root
configuration now matches those package checks. The application navigation code
and its suppressions were preserved.

Independent standards/security and specification reviews found no integration regression: schema fields
from both parents, patch bytes, migration bytes, roadmap IDs and dependencies
were checked against the pinned parents. Further build, runtime smoke and final
CI results are recorded in the PR.

Read-only access checks still found no installed Claude client. Existing Chrome
automation is available; navigating to Claude redirected to its login page.
No sign-in, consent or chat submission was attempted. The ephemeral Railway
environment `forge-pr-2405` has a successful Manager deployment; Auth has no
deployment and the preview does not establish matching OAuth or delegated Admin
configuration. Local synthetic browser sign-in remains subject to the user's
specific authorization after the earlier automatic approval rejection. Real
Claude, OAuth consent, authenticated exact-render approval and hosted renderer
qualification remain separate acceptance gates.
