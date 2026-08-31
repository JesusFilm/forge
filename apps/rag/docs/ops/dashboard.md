# RAG status dashboard operations

The public dashboard is a committed, redacted static artifact. RAG owns only
`/rag-status/`; `docs/pages/site` owns the shared Forge Pages root, and
`docs/pages/manifest.yaml` is the complete publication allowlist. CI and the
Pages deployment never query a database and receive no production credentials.

## Prepare a release

1. Refresh and validate production data using the approved `production-read`
   procedure in `environment-and-secrets.md`. This credentialed operator step is
   outside CI.
2. Run `pnpm --filter @forge/rag dashboard:build` and
   `pnpm --filter @forge/rag dashboard:verify`.
3. Assemble into a new, empty path:

   ```sh
   pnpm --filter @forge/rag pages:assemble -- /tmp/forge-pages-candidate
   ```

4. Confirm the assembler lists exactly `index.html` and
   `rag-status/index.html`. Review the committed dashboard change and its
   non-secret provenance. Never add snapshots, lifecycle YAML, eval case data,
   corpus content, internal notes, or credentials to the manifest.

This is the **prepared** state. The assembler refuses path traversal, symlinks,
undeclared files, missing files, duplicate declarations, and destination
collisions. It also prints a content digest for the complete assembled tree.

## Publish, verify, and accept

Merging a reviewed Pages-scoped change to `main` is the publication authority;
the protected `github-pages` environment may require a separate repository-owner
approval. The sole `forge-pages` workflow verifies and uploads the committed
tree, then the minimally privileged deploy job publishes that same artifact.
The workflow does not install dependencies or execute repository code in the
deploy job.

After a successful deployment (**published**), an authorized operator must:

- record the workflow run, main commit, assembled SHA-256 digest, deployment ID,
  and reported Pages URL;
- open the Forge root and `/rag-status/` directly, then refresh both URLs;
- confirm visible counts agree with `dashboard/compiled-data.json`;
- confirm the RAG page performs one document request and no API, font, script,
  image, or Railway request;
- compare three warm-browser runs with the retained standalone static page. The
  candidate may not add requests or transfer more than 5% additional bytes, and
  median DOMContentLoaded may not regress by more than the greater of 100 ms or
  10% without an explained and approved exception;
- confirm the served content identifies the intended source commit and remains
  available while the `forge-rag` Railway service is unavailable.

Passing those checks is **verified**. A repository owner then marks the redacted
receipt **accepted**. Only an accepted receipt tied to the commit and digest may
satisfy a later migration gate. Do not put URLs with tokens, response bodies,
database details, raw eval cases, or secrets in the receipt.

## Failure and rollback

If publication fails or the served commit/digest is wrong, do not accept it.
Revert the offending reviewed commit (or restore the last-known-good root and all
declared producer files) through a new PR to `main`; the same workflow republishes
the complete site. Never reconstruct siblings from a previous deployment and
never deploy a local worktree. Repository-owner unpublish is reserved for urgent
sensitive-content containment; follow it with credential rotation if exposure is
possible and a reviewed last-known-good republication.

## External enablement blockers

Code completion does not enable GitHub Pages. Before first publication, the
repository/platform owner must confirm the project-site URL and base path, set
GitHub Actions as the Pages source, approve the shared `github-pages`
environment and its protection rules, and confirm no existing Forge Pages tree
will be displaced. If shared Pages ownership is rejected, stop and amend the
architecture decision before considering the documented Railway static-host
fallback; do not maintain both publishers.
