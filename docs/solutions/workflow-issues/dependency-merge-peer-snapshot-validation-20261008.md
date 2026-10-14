---
title: Verify peer snapshots after merging dependency lock updates
date: 2026-10-08
category: workflow-issues
module: ci
problem_type: workflow_issue
component: development_workflow
severity: high
tags: [pnpm, lockfile, dependencies, merge, audit]
---

# Verify peer snapshots after merging dependency lock updates

A dependency branch can update transitive tools while current default changes the same workspace's peers. A syntactically resolved YAML merge can still contain references to nonexistent peer snapshots. Frozen installation is the necessary check; a successful lock-only command alone is insufficient.

## Observed cases

The xmldom backport conflicted with newer ESLint resolver snapshots for TypeScript 5 and 6. Preserving the branch's optional-peer snapshot together with both current-default snapshots retained both inputs. Frozen installation verified the resolved graph.

The Babel runtime update refreshed Terser while current default advanced Expo from 57.0.26 to 57.0.27. Resolving the Expo hunks while retaining Babel 7.29.7 left a Better Auth peer reference containing the old Terser version. `pnpm install --lockfile-only --ignore-scripts --offline` exited successfully without rebuilding that reference; the following frozen install rejected it with `ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY`.

Use the repository's pinned pnpm 9.12.3 to repair graph references after reviewing each conflict:

```sh
corepack pnpm install --lockfile-only --fix-lockfile --no-frozen-lockfile --ignore-scripts
corepack pnpm install --frozen-lockfile --ignore-scripts
```

Try offline resolution when useful cached metadata exists. Missing registry metadata is a concrete reason to retry online, with lifecycle scripts still disabled during graph discovery. This is lock repair, not permission to discard the bot update or replace current-default manifests. Compare the final package-version inventory against both inputs before accepting regeneration. In the Babel case, the repaired graph introduced no package versions absent from both original inputs; older Expo entries were superseded by current default.

Then run normal installation, repository hooks and the meaningful application/schema contracts on the committed candidate. Inspect the exact-head CI result. Keep application qualification separate from deployment/provider receipt acceptance.

## Whole-lock audit fallback

Pinned pnpm 9 spent several minutes expanding this repository's audit paths without completing JSON output. Preserve the invocation and its termination evidence. A metadata-only audit directory containing an exact copy of the lockfile and a minimal private manifest allowed pnpm 12.5.1's ecosystem-native audit to complete, without lifecycle scripts or changes to the repository's package manager, manifests or lockfile. Audit default and candidate with the same audit engine, compare advisory/package identifiers, and retain the tool version and complete report. This fallback does not replace pinned frozen installation or application validation.
