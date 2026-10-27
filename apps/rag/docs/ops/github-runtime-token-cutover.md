# Portal GitHub runtime token cutover

The portal repository credential is distinct from the eligibility CI token and
OAuth client secret. Rotate only the runtime credential in this operation.

1. Verify replacement identity, main branch, SHA-pinned portal allowlist, user
   identity and collaborator permissions against GitHub. Public reads alone do
   not prove organization approval.
2. Save the verified value in the canonical operator vault and stage the matching
   Railway runtime variable without triggering a manual deployment.
3. Merge this watched-path runbook through PR-to-main to apply the staged
   credential through normal Railway autodeploy.
4. Verify the deployed credential matches the vault, repeat required GitHub
   checks from the runtime, check health, and perform fresh portal sign-in and
   a protected portal read before retiring the previous runtime token.
5. Verify the previous value is rejected while replacement access remains valid.
   Remove the temporary pending vault entry and close the incident tracker only
   after live verification and retirement.

Never record credential values or Authorization headers. Preserve unrelated
credentials. Regeneration is unnecessary when the separately created replacement
has been approved. A failed deployment or portal check leaves the rotation open;
do not claim service restoration from a successful GitHub probe alone.
