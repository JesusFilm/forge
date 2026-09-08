# PR 2205 Admin and owned-harness CI follow-up

Fixed base: `56258cff495248f8f94e1a57ba5d34643f61af3a`. This implementation-only follow-up addresses CI jobs 102248973053 (Admin lint), 102248972593 (delivery DB fixture), 102248973021 (release-controls unit test) and the owned loading-harness finding in CodeQL check 102248731414. Root provided exact CI logs; no CI rerun or external action was performed here.

## Diagnosis and corrections

- The verifier's local `module` binding violates `@next/next/no-assign-module-variable`. Rename it to `workflowModule`; all four manifest/compiled-runtime checks remain unchanged.
- The deterministic recommendation fixture sets up a custom schema; Prisma's schema-specific connection cannot see omitted Studio relations merely because the migration database has them in public. The actual retriever correctly references `studio_catalog_release`, `studio_publication` and `studio_project`. Add minimal read-model tables to deterministic fixtures and explicit public views to the production-snapshot fixture. Do not change canonical SQL, migrations, publication or transcript contracts. The snapshot mode is not executed here and still requires an actual compatible restored snapshot.
- The default-off controls test deliberately unsets CI to enable real environment validation, but relied on ambient auth values. CI supplied neither required auth value. The test now stubs its required database/session/auth inputs locally, restores them afterward, and still checks both controls default off and enable independently. Product defaults and validation are unchanged.
- The loading harness reflected the `variant` query parameter into a script attribute. Only three fixed strings returned by an explicit switch now reach HTML or bundle lookup; missing/unknown/prototype/malicious values return 400. Image routes remain unchanged. The test extracts and executes the actual HTTP callback with request/response doubles; it does not duplicate sanitizer logic or run browser measurements.

Ranked database hypotheses were fixture omission, schema-specific lookup and migration history. Actual `42P01` reproduction, the explicit fixture DDL/view list and the unchanged canonical predicate establish the first two; the fix requires no migration changes. For the controls failure, missing required auth values reproduce the exact CI validation errors; there is no product-default defect.

## Results and limits

| Check                         | Result                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verifier ESLint               | Red: exact reserved-variable rule; green: changed-file lint passes.                                                                                                                                                                                          |
| Delivery DB file              | Red: 2 passed/1 failed with exact 42P01. Final: all 4 passed, including original 3 and actual retriever staged/receipt-with-draft/published/revoked/Core visibility.                                                                                         |
| Intermediate added regression | `ci-delivery-green.log` is **not green**: original 3 passed, but the new test selected target 11 outside the bounded top-10 candidate set. Changed the fixture identity to known-included target 1; retained the failure and final actual result separately. |
| Release controls              | Red: missing AUTH_ISSUER_URL/AUTH_ADMIN_CLIENT_ID; green: 1 passed with real validation and unchanged default-off assertions.                                                                                                                                |
| Harness HTTP response         | Red: malicious query returned 200; green: fixed variants work and untrusted/missing variants return 400 without reflection.                                                                                                                                  |
| Admin source validation       | Changed-file ESLint and Admin typecheck pass. Calendar verifier passes against the retained generated build artifacts. No new application build was necessary for an identifier-only script change and test-fixture repairs.                                 |

Tests use the recorded owned network namespace wrappers, rootfs TMPDIR, denied default 5432/6379, private loopback 55463 and the existing owned disposable Postgres cluster. No shared DB/Redis or providers were touched. Fixture candidate timing is not production performance evidence. The full Admin suite is not rerun; root's actual CI result was 6387 passed, 1 failed, 245 skipped and 1 todo before this correction.

Historical loading measurements, bundle identities and earlier logs remain byte-for-byte unchanged. The exact pre-fix harness remains available at `56258cff:docs/validation/studio-main-integration/harness/loading-fixture.cjs`; it is not copied into another executable scan path. The parent SHA256SUMS records that historical blob; this commit updates the current manifest for the secured harness and adds this follow-up. No claim is made that historical measurements ran the corrected harness or that local tests establish a clean CodeQL scan. Root owns the next normal CI run.

Independent Standards and Spec reviews use the fixed base above. Full release acceptance and external gates remain open; no push, deployment, provider call, benchmark rerun, scan suppression or production-control change occurs in this slice.

## Review

Standards: no actionable findings in the three Admin files or secured harness. Spec: no source/spec conflicts; canonical visibility, independent default-off controls and historical measurement identity remain intact. Both reviewers were read-only and ran no checks. Normal hook outcome and final SHA are delivered with the commit handoff.
