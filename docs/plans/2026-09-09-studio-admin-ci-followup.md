# PR 2205 bounded Admin CI repair

Fixed base: `56258cff495248f8f94e1a57ba5d34643f61af3a`. Fix only the calendar build verifier's reserved local identifier and recommendation delivery test fixtures' canonical Studio visibility dependencies. Preserve production queries, authority, migrations, generated contracts, renderer tooling and workflow configuration.

Reproduce the reported ESLint error and three-case deterministic DB failure on owned Postgres in a network namespace (55463; default 5432/6379 denied). Add fixture relations/views matching the existing read predicate and a regression exercising staged/published/revoked visibility through the actual retriever. Run affected lint, verifier on retained generated build outputs, DB file and Admin types. Independent fixed-base Standards/Spec review, normal hooks, one implementation-only local commit; no push or CI rerun. Retain red/green evidence without claiming production or snapshot acceptance.

Root added the actual release-controls test CI failure (required auth environment absent) and CodeQL reflected XSS in the owned loading harness. Supply explicit test-only required environment without bypassing validation. Restrict HTTP variants to fixed literals, test the exact callback red/green, and retain historical measured evidence unchanged in Git; no benchmark rerun or executable vulnerable copy.
