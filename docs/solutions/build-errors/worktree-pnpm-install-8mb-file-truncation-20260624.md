---
title: "Fresh git worktree: pnpm install truncates large node_modules files at exactly 8MB"
date: "2026-06-24"
category: build-errors
module: git-worktrees
problem_type: build_error
component: tooling
severity: high
symptoms:
  - 'esbuild crashes loading any config: "The service was stopped: write EPIPE" (vitest, tsx, anything esbuild-backed)'
  - 'eslint crashes requiring typescript: "typescript.js:NNNNN SyntaxError: Invalid or unexpected token"'
  - "pnpm rebuild esbuild fails in postinstall with the same EPIPE — the binary itself is corrupt"
  - "tsc-based typecheck still passes while vitest and eslint both fail, masking the real cause"
  - "the broken files are all exactly 8388608 bytes (8 MiB): typescript.js, the turbo binary, the @esbuild platform binary"
root_cause: incomplete_setup
resolution_type: environment_setup
related_components:
  - development_workflow
tags:
  - pnpm
  - git-worktree
  - esbuild
  - typescript
  - turbo
  - devcontainer
  - monorepo
  - vitest
---

> **Confidence note.** This was a **single, unreproduced occurrence**. The
> symptoms, the 8 MiB signature, and both recovery paths below are recorded
> as observed; the root cause (see "Why This Works") is a **hypothesis**, not a
> confirmed mechanism. Treat this as an incident note with a working recovery,
> and rule out the alternative causes listed under Prevention before assuming
> the filesystem theory. (The `severity: high` in the frontmatter reflects
> _impact_ — a fully broken test/lint toolchain when it hits — not frequency;
> this was seen once.)

## Problem

In a freshly-created git worktree, `pnpm install --frozen-lockfile` produced
node_modules files larger than 8 MiB truncated to exactly 8388608 bytes,
corrupting the `typescript`, `turbo`, and `esbuild` binaries/bundles. `vitest`
and `eslint` then crashed with unrelated-looking errors, while `tsc`-based
typecheck kept passing — masking the real cause.

## Symptoms

- `pnpm --filter <pkg> test` (vitest): `Error: The service was stopped: write EPIPE` thrown from `esbuild/lib/main.js` while loading `vitest.config.ts`.
- `pnpm --filter <pkg> lint` (eslint): `typescript.js:182489 case 263 /* F  ^^^^  SyntaxError: Invalid or unexpected token` — `@typescript-eslint` `require()`-ing a truncated `typescript.js`.
- `pnpm rebuild esbuild` re-runs the postinstall and fails the same way — the platform binary is itself truncated, so re-running the install step does not heal it.
- **Tell-tale signature:** in this occurrence the broken files were all _exactly_ `8388608` bytes (`8 * 1024 * 1024`). `find node_modules -type f -size 8388608c` listed exactly the files that had been larger than 8 MiB. This grep is a strong first signal, not a proof — see the false-positive/negative caveat under Prevention.

## What Didn't Work

- **`pnpm rebuild esbuild`** — re-runs esbuild's postinstall, which itself shells out to the truncated binary and dies with the same EPIPE. Rebuilding does not re-fetch/re-link a clean file.
- **Trusting typecheck as a health signal** — `tsc --noEmit` passed throughout. In this case the truncation point happened to fall _after_ the entrypoint `tsc` loads, so `tsc` survived while eslint's `require("typescript")` of the truncated `lib/typescript.js` did not. This is content-dependent: a cut at a different offset could break `tsc` too, so a green typecheck is not evidence the toolchain is healthy.
- **Assuming it was an esbuild-version or config problem** — the EPIPE looks like an esbuild service bug, but the same 8 MiB truncation hit `typescript.js` and the `turbo` binary too. Chasing esbuild alone would have missed the other two.

## Solution

### Default: clean reinstall, then re-smoke immediately

Because the corruption happens _during_ the install, the first move is to redo
the install and verify before trusting it — this assumes nothing about any
other checkout:

```bash
cd <worktree>
rm -rf node_modules
pnpm install --frozen-lockfile

# Re-smoke immediately — the install itself is what truncated last time, so a
# clean reinstall can reproduce it. If the find prints anything, retry the
# reinstall (or fall back to the copy recipe below).
find node_modules -type f -size 8388608c   # expect: no output (necessary, not sufficient — the test+lint below is the real check)
pnpm --filter <pkg> test && pnpm --filter <pkg> lint
```

### Escape hatch: copy intact files from a known-good checkout

Faster than a full reinstall, but only valid under strict preconditions. Reach
for this only if the default reinstall's re-smoke still prints truncated files,
or a reinstall is impractically slow — otherwise stop at the default.

**Preconditions — all three must hold, or you risk silently installing wrong
bytes (worse than the loud crash you're fixing):**

1. The source checkout is the **same OS + CPU architecture** (the store paths bake in the platform, e.g. `@esbuild+linux-arm64`, `turbo-linux-arm64`).
2. It pins the **same pnpm version** (`corepack`/`packageManager`) and the **same lockfile** — so the `.pnpm` store layout matches.
3. Its copy of each file is **itself intact** — the `test`+`lint` smoke below is what actually confirms this; the `8388608c` size re-check only catches a source file truncated to the _same_ 8 MiB, not corruption of another size/shape.

```bash
cd <worktree>
SRC=/workspace   # a known-good checkout meeting all three preconditions above

# Drive the copy off the ACTUAL truncated paths — no version guessing. Each
# discovered path is relative (node_modules/.pnpm/typescript@<real-ver>/...),
# so it maps 1:1 onto $SRC. If the path doesn't exist under $SRC (e.g. arch
# mismatch), cp errors loudly instead of silently copying nothing.
find node_modules -type f -size 8388608c | while read -r f; do
  cp "$SRC/$f" "$f" || echo "MISSING IN SRC: $f  (arch/version mismatch?)"
done

# Verify: nothing still 8 MiB (catches a source file that was ALSO truncated),
# then smoke the toolchain.
find node_modules -type f -size 8388608c   # expect: no output (necessary, not sufficient — the test+lint below is the real check)
pnpm --filter <pkg> test && pnpm --filter <pkg> lint
```

Any `MISSING IN SRC` line means the recovery is incomplete (usually a wrong-arch
or wrong-version `$SRC`) — fix the source and re-run; don't trust the smoke until
the copy loop is clean.

After recovery, `vitest`, `eslint`, and `tsc` all run normally in the worktree.
(Symlinking the worktree's esbuild package dir to the source checkout's also
works, but a straight `cp` is simpler and avoids cross-tree symlink surprises.)

## Why This Works

The recovery works regardless of root cause: it replaces invalid bytes at the
exact store paths the resolver already points at, and the re-smoke confirms the
result. The copy path additionally relies on the source checkout being the same
OS/arch + pnpm version + lockfile, so its `.pnpm` virtual-store layout is what
the worktree expects.

**The cause itself is unconfirmed.** The observation is a _write-side_
truncation during the worktree install — files clipped to exactly 8 MiB, a hard
power-of-two boundary. That pattern is _consistent with_ an overlay/copy quirk
in the devcontainer filesystem under concurrent large-file writes, but it was
seen once and never isolated (no repro, no filesystem/kernel log captured). 8
MiB is a generic buffer/limit boundary, not a fingerprint unique to any one
cause — do not let "almost certainly the filesystem" foreclose diagnosis if you
hit this again.

## Prevention

- **After creating a worktree and running `pnpm install`, smoke the toolchain before trusting it** — run `test` AND `lint`, not just `typecheck` (which can pass over the corruption, as above). As a fast pre-check, `find node_modules -type f -size 8388608c` is a **strong signal worth investigating** — though a file that is legitimately exactly 8 MiB would be a rare false positive, and corruption at a _different_ size or shape would be a false negative. Pair it with the test+lint smoke as the authoritative check, not the grep alone.
- **Don't reach for `pnpm rebuild`** when a binary is corrupt this way — it re-invokes the broken binary. Use the clean reinstall (default) or the copy escape hatch above.
- **Before blaming the devcontainer filesystem, rule out other 8 MiB-boundary causes** that produce the same clean truncation: an `RLIMIT_FSIZE` / `ulimit -f` file-size cap on the install process, `ENOSPC` or a disk-quota limit hit mid-write, or an OOM-killed / aborted install. These have different fixes than "retry the install."
- This is distinct from the two known worktree gotchas already documented: the missing-`lint-staged`-binary husky failure (`.claude/rules/worktree-commit-husky.dev.md`, fixed by `pnpm install`) and `docs/solutions/platform/devcontainer-setup.md` (corepack/pnpm version pinning). Neither heals an 8 MiB truncation — this needs the reinstall or file-replace above.
- If it recurs, capture evidence before recovering (the exact truncated paths, `ulimit -a`, `df -h`, `dmesg`/OOM logs) so the cause can finally be isolated rather than band-aided again.
