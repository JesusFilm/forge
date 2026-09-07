# Independent calendar review checkpoint

Fixed reviewed base: `2d4d9bb8fe544335a32778043936b38f5ca5a0c3`.
Original frozen WIP tree: `211e76a5c17132f7ce2dee391565489e263deb84`.
Diff command: `git diff 2d4d9bb8fe544335a32778043936b38f5ca5a0c3 211e76a5c17132f7ce2dee391565489e263deb84`.
No commits since base. A temporary alternate Git index captured tracked and
untracked source/evidence without changing the normal index, HEAD or ancestry.
Prebuilt runtime artifacts were excluded. Standards and Spec agents reviewed
independently, read-only; reports below refer to this immutable original tree.

## Standards — original report

Two actionable findings:

- **P2: Serialize configuration with weekly version updates.** `calendar.ts:95`
  takes an advisory lock, reads N and unconditionally upserts N+1, while
  `assignWeek` uses a row lock. A weekly update can commit N+1 between the read
  and upsert, allowing stale configuration and version reuse. This violates the
  observed-version convention in `packages/studio-contracts/CLAUDE.md` and the
  transaction pattern in `studio-command-revisions-and-publication-latch.md`.
- **P2: Reuse Manager's established palette.** `calendar.css:31` introduces
  `#8b8b8b`, `#294848` and `#0008`, absent elsewhere in Manager. Manager's
  AGENTS.md UI styling rule prohibits new one-off colors without approval.

No additional judgment-only smell warranted a finding. Performance acceptance
remains unresolved; the review did not infer a pass from the retained samples.

## Spec — original report

Two defects and one partial requirement:

- **P1: Configuration changes can reuse a calendar version.** The race above can
  allow an admission with obsolete default packs to pass completion's version
  check. Violates the execution plan's stale-revision verification and assigned/
  default-pack boundary.
- **P2: Definitively rejected production requests cannot adopt corrected
  selections.** `calendar-production.tsx:36–58` retains even HTTP400 admission
  rejection; the fieldset remains disabled with the obsolete revision until
  component reset. Violates the roadmap's actionable-state requirement.
- **Partial: Automatic weekly-theme suggestions are absent.** The brief
  (`2026-09-07-studio-video-authoring-brief.md:72–75`) requires titles/themes
  “including weekly themes.” The original result/completion only updates slots;
  weekly settings were human-only.

The final schedule UI, due dispatch, fresh 460 readiness and Watch acceptance are
known dependencies, explicitly not implemented or claimed complete by this review.

## Resolution and follow-up

Resolved in the follow-ups below: row-lock regression/fix, palette token reuse,
confirmed rejection recovery separated from ambiguous completion, and strictly
admitted complete-week suggestions with immutable provenance and operator-race
guards. Original red/green logs and review targets are retained here.

**Unresolved performance must accompany final release review:** create-cold
controls +59.1 ms and script CPU +13.1 ms in the single 40-sample AB/BA follow-up.
Offline attribution found no concrete new create operation explaining the gap.
No speculative optimization or additional measurements are authorized. See
`../loading/README.md`; this is not a performance pass or full feat-461 acceptance.

## Independent follow-ups

First follow-up frozen tree: `3ea1e65b8e4a610dcc25a0e491581d17bdbabd8b`.
Final code follow-up tree: `f1a66fcc35c321715b1b320733a330462963a52c`.
Both retain the original fixed base above. Follow-ups reviewed only the deltas;
the original findings and evidence were not replaced.

### Standards

No new actionable Standards findings in the final frozen delta. Weekly completion
checks every admitted slot's version, resolving the pack-only edit race. Generated
weekly themes retain their source pack in provenance without changing effective
pack assignments. The typed read contract and UI preserve that distinction.
Previously cleared configuration locking and palette findings remain cleared.

### Spec

The first follow-up found that a pack assigned to one slot could be promoted to
the whole week, silently changing neighboring dates. Final completion stores the
chosen pack only in immutable suggestion provenance; effective weekly assignment
stays null. Every covered slot must retain its admitted version. Regression cases
cover both pack promotion and a human pack-only edit after admission. No new
concrete defects were found in the final narrow delta. Original configuration and
production-recovery findings remain closed.

Both reviewers performed read-only inspection, without validation commands or
mutations. Their clearance covers current calendar code, not final 460 integration
or unresolved performance acceptance. Subsequent build checking required only an
explicit contract-derived type for the admission's `slots` array.

### Delta validation

- Calendar production-adapter database suite: nine passing tests, including the
  real configuration/weekly lock race, automatic following-fortnight admission,
  out-of-admission completion, human weekly edit, pack-only edit and pack scope.
- Contracts: five passing tests; weekly output is strictly titles/themes with
  exact admitted identities and source indices. IANA and DST tests remain.
- Native planner: four passing tests, including weekly-only tool-free generation.
- Native database: two passing tests retaining instruction isolation, provenance,
  consumed claims and ambiguous terminal settlement.
- Production route: two passing tests distinguish confirmed non-admission from
  ambiguous admission/execution failure. Browser verification is recorded below
  once the final builds complete.

## Built evidence follow-up

Admin and Manager production builds pass; native production build and types pass.
The built weekly chain persisted exactly one weekly suggestion with zero tools,
missing-source provenance, unchanged slot rows and unchanged human weekly settings.
The first harness assertion expected `completed` while the actual enum is `complete`;
the failure is retained. Corrected assertions resumed the same persisted run without
another generation request. `weekly-persisted.json` and `weekly-model-request.json`
retain the admitted context, exact result and frozen native provenance.

`definite-production.json` shows HTTP409 with confirmed rejection and no attempt;
explicit reconfirmation uses revision2 and a new key, creates one attempt and leaves
revision2 unchanged. `ambiguous-production-retry-browser.json` removes only the
terminal batch marker after completion: exact retry creates no additional attempt
or model request and does not apply the proposal.

Evidence review then found one further Spec P2: the parent calendar card remained
at its pre-generation status after the terminal batch. The built screenshot and
`terminal-refresh-red.json` retain that failure. The UI now refreshes after a
confirmed terminal response; refresh failure is reported separately, without
reclassifying known completion as ambiguous. Missing terminal markers still retain
the exact envelope. This final correction's built check and follow-up follow below.


## Final bounded checkpoint

Final frozen code tree: `12ba7d41021f0a85e4df79b8897a8f23d79e32b8`,
reviewed against prior `f1a66fcc` and original fixed base `2d4d9bb8`.
The Manager rebuild and final built rejection/reconfirmation check pass.
`definite-production-terminal-refresh.json` records revision2→3 by the explicit
human metadata edit, zero attempts on rejection, then one retained attempt at
revision3. The calendar card updates to “Production: succeeded” without reload;
publication remains unapproved. No generation result was applied.

**Standards:** no new actionable issues in the final frozen delta. Terminal
refresh occurs only after a complete batch response. Refresh failure preserves
known completion; interrupted responses retain the exact pending request.

**Spec:** terminal-refresh P2 closed. Built evidence shows the new retained
attempt, unchanged revision after generation and refreshed card. No new actionable
findings in this delta; all reported current-scope Spec defects are closed.

Both independent reviewers inspected the frozen delta and retained built evidence
read-only. Remaining current-scope findings: Standards 0, Spec 0. This bounded
checkpoint does not approve performance or claim the missing final schedule
UI/dispatch/readiness/Watch integration. The create-cold +59.1 ms and script CPU
+13.1 ms outcome remains unresolved; there were no further loading measurements.
