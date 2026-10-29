# Automation recovery PR stack validation

The recovered changes use a declared stack on main
`48ad42865e1c1e87569d09be7ac950ffda228923`:

| PR                                            | Local layer                                | Parent |
| --------------------------------------------- | ------------------------------------------ | ------ |
| #886 source execution                         | `d7d537c7e4d5c371073da879983edaf3aba712d9` | main   |
| #916 response handling and UI                 | `8158c0562465ec5316eae83ae5080a0f89a8ba86` | #886   |
| #870 recurring automations and Mastra reports | `54d15b9cdb14999a048234fd12c0eca45ebb8959` | #916   |
| #1087 durable enrichment execution            | `7b106aa5d0e5bd450fda6d1900bf4ee00ef5be13` | #870   |

The execution restoration has exactly the same Git tree as the integrated,
tested candidate `8384ff1d2ee391a2dc3a0f4a14ab29ac496a9077`:
`bbd5d5d095d6fd029de8901f8693b315f054f27e`. A full `git diff --exit-code`
between those commits passes. Subsequent closeout changes update documentation
and roadmap status only.

## Layer checks and independent review

- #886: 182 Mastra and 91 Manager focused tests; both fresh typechecks and full
  linters; frozen install, source pin and enabled commit hooks. Independent
  reconstruction review found no actionable P0–P3 findings. Its source-only
  17-file policy remains `3e46dd8c…43f62` with all four Manager bindings matching.
- #916: 31 Manager focused tests, fresh typecheck, full lint and enabled hooks.
  Independent review confirmed UI source matches reviewed `c1f3fa60a`, with the
  response fix from `677e82f67` preserved. Existing keyboard, explicit-create,
  short-viewport and page-load evidence remains historical; no new browser run
  was claimed.
- #870: 184 Manager, 220 Mastra and 2,339 Admin focused tests; all three fresh
  typechecks, strict full linters and production builds; frozen install,
  regenerated foundation-only SDL/introspection and enabled hooks. Independent
  reconstruction review found no actionable P0–P3 findings.
- Root then ran the 19 previously skipped #870 database cases on its exact layer:
  all 9 lifecycle and 10 recovery cases passed on a new task-owned PostgreSQL
  cluster. The fixture applied only foundation migrations and used the real
  Prisma PostgreSQL adapter. It tested SDK start ordering with deterministic
  runtime storage/queue adapters. Its cluster was stopped after verification.

The integrated suites passed 1,737 Manager, 4,139 Mastra and 9,981 Admin tests.
The full Admin suite preceded the latest main integration; afterward the fresh
four-shard Admin typecheck, strict lint, production build and 2,332 focused
instrumentation/schema-security tests passed. Manager and Mastra application
source did not change during that main integration. All three package builds
pass; Mastra Studio build analysis used CI/development/memory settings, matching
the Docker build-analysis lane rather than proving production storage readiness.

## Runtime and database acceptance

An actual Admin build exposed missing scheduler discovery. The four-line
GraphQL app-entry import registers the existing definition without starting it.
The repaired production build includes 79 steps and 23 workflows and passes all
three postbuild registration verifiers.

The updated committed graph completed through native Manager HTTP handlers,
real Admin Pothos GraphQL/services and disposable PostgreSQL: all 31 graph
requests returned 200 and the persisted job completed at revision 20. Namespace
preparation, source verification, canonical artifact reads/writes, correction
reports and Manager Mux synchronization passed. Real Admin operation claims
blocked both run replacement and terminal invalidation while a stage remained
incomplete. Foreign namespaces and unverified reuse failed before admission.
See `docs/validation/manager-enrichment-admin-2026-10-29/` for receipts and bounds.

Independent execution/security review cleared the integrated graph, per-stage
claims, job-owned artifact namespaces, callback CAS, OAuth and ambiguity gates.
The execution layer restores the 18-file `6d65176d…367d426` policy and all four
Manager bindings together. Admin migrations are 0165 automations, 0166 execution
operations and 0167 revision; Mastra admission uses migration 005.

These proofs use deterministic external providers, Mux transport and embedding
ingest. They do not establish live provider/S3 behavior, production ingress/SSO,
image readiness or replica throughput. Flags remain default-off. No deployment,
provider request or PR merge occurred. Remote CI must be assessed after each
published layer; local verification alone does not establish remote mergeability.
