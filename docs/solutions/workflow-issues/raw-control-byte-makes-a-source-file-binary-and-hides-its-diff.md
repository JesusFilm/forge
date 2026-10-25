---
title: "A raw control byte in a regex character class makes git call the file binary, hiding its diff from review"
module: "git / PR review (binary diff detection)"
date: "2026-09-17"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "high"
symptoms:
  - "git diff prints 'Binary files a/... and b/... differ' with no hunk, for a plain-text source file"
  - "git diff --numstat prints a dash for added and deleted counts instead of numbers"
  - "A pull request shows no reviewable diff for the file, so reviewers approve logic they cannot see"
  - "A reviewer can only read the change through the blob, with git cat-file -p or git show <ref>:<path>"
root_cause: "wrong_api"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/lib/lastWatched/snapshot.ts"
  - "apps/tv/src/lib/auth/profile.ts"
  - "packages/watch-url-policy/src/watch-home-tiles.ts"
  - "apps/web/src/lib/watch-analytics-contract.ts"
tags:
  - "regex"
  - "control-characters"
  - "git-diff"
  - "code-review"
  - "sanitization"
  - "eslint"
---

## Context

Five reviewers examined `apps/mobile/src/lib/lastWatched/snapshot.ts` during a
review of PR #2328. Two of them could not read the diff. GitHub showed none,
and `git diff` printed `Binary files a/... and b/... differ`. The file is a
126-line plain-text TypeScript module with no binary content.

One line caused it. The character class in `sanitizeLastWatchedTitle` held
three literal control bytes — NUL, 0x1F and 0x7F — instead of the escape text
`\x00`, `\x1F` and `\x7F`. A byte dump of the line read
`2f 5b 00 2d 1f 7f 5d 2b 2f 67`. Git treats a NUL byte anywhere in a file as
proof the file is not text, so one byte turned the whole module into an opaque
blob for every tool that reads a diff.

The file matters. It is the only boundary between an untrusted, URL-controlled
string and a notification body that renders on a locked device. The module the
review most needed to see was the module the pull request could not show.

## Guidance

**Write a control-character range as escape text, never as the byte itself.**
Use `\x00`, `\x1F`, `\x7F`, or the `\uNNNN` form. Three
files in this repo already do this and are the convention to match:
`apps/tv/src/lib/auth/profile.ts`, `packages/watch-url-policy/src/watch-home-tiles.ts`,
and `apps/web/src/lib/watch-analytics-contract.ts`. The last one avoids the
regex entirely and scans code points with `charCodeAt`, because an inline lint
suppression on a control regex "is indistinguishable from a mistake".

**Watch the tool that writes the file, not only the text you typed.** This byte
arrived because escape text in a code-editing tool's payload was interpreted as
an escape at the payload layer. The author wrote four characters and the file
received one byte. The final file looks correct in an editor, so nothing in the
result records the mistake.

**Put `// eslint-disable-next-line no-control-regex` directly above the line
holding the regex literal.** The directive covers exactly the next line. Above
the `const`, with the regex on a later line, it protects nothing: ESLint then
reports an unused-disable warning AND the underlying error. The working shape
is at `apps/mobile/src/lib/lastWatched/snapshot.ts:53-54`.

**Check the bytes, not the echoed diff.** An editing tool's summary of what it
wrote is not evidence of what reached the disk; the mismatch between those two
is this whole failure.

```
file apps/mobile/src/lib/lastWatched/snapshot.ts
# "Unicode text, UTF-8 text" is clean. "data" means a control byte got in.

git show <commit>:<path> | file -
# Reads one commit's blob directly, so it works on history too.
```

## Why This Matters

Nothing in the toolchain caught it. The escape text and the raw byte compile to
the same regular expression, so behaviour was correct throughout and `tsc`,
ESLint, Prettier and the full test suite all passed. Each of those checks reads
program behaviour or string content. None reads whether the source stayed
representable as a text diff.

This repo has no mechanical guard. There is no `.gitattributes` anywhere, so
nothing forces the path to be treated as text. No CI job sweeps changed files
for binary classification. The pre-commit hook runs `lint-staged` and
`format:check`, and neither reads raw bytes. The only backstop today is a
reviewer noticing that a diff will not render.

The cost is not a wrong sanitizer. The sanitizer was right. The cost is that a
security boundary shipped with no reviewable diff, and the defect that hid it
was invisible in the very artifact review depends on. A check that only fires
when a careful reader happens to look does not scale.

## When to Apply

- Writing or editing any regex that names a C0, C1 or DEL range, especially
  through a tool whose payload interprets escape text before it reaches disk.
- Reviewing a pull request that shows no diff, or reports binary files, for
  something you know is plain-text source.
- Adding an `eslint-disable-next-line` near a multi-line `const`, where the
  directive and the literal can land on different lines.
- Building a sanitizer that is the sole boundary between untrusted input and a
  sensitive rendering surface. The review that would catch a mistake there
  depends on the diff being visible at all.

## Examples

Before, with a literal NUL as the first member of the class. It is shown here
as a placeholder, because writing the byte into this document would make this
document binary too:

```
const TITLE_INVISIBLE_OR_REORDERING =
  // eslint-disable-next-line no-control-regex
  /[<NUL byte>-\x1F\x7F-\x9F ... ]+/g
```

After, at `apps/mobile/src/lib/lastWatched/snapshot.ts:52-54`, where every
member is escape text:

```
const TITLE_INVISIBLE_OR_REORDERING =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1F\x7F-\x9F\u00AD\u061C ... ]+/g
```

The fix moved this file's diff from `-` and `-` to `45` added and `1` removed.

One trap when you verify a fix from history: git reports the pair as binary if
EITHER side carries the byte. Diffing the bad commit against its immediate
parent still shows nothing, in both directions. To read one commit's own state,
go to the blob with `git show <commit>:<path> | file -` rather than to a diff.

## Related

- `apps/mobile/CLAUDE.md:911` carries a one-line version of this rule. This
  document adds the mechanism, the detection commands, and the lint-directive
  placement.
- `docs/solutions/security-issues/invisible-character-class-gap-defeats-url-redaction.md`
  is the sibling failure: a character class built wrongly, invisible to every
  normal check, caught only by inspecting the artifact at byte level. Consider
  consolidating the two if a third case of this family appears.
- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`
  argues that review catches what green checks cannot. This is a worked case:
  every automated check passed and only a reviewer found it.
