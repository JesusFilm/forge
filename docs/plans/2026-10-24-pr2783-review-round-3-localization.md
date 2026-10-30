# PR #2783 round 3 localization repair

Start exactly at `e96adbc57c06730cce00572155d4625367d021d2`; push only the editor branch with its exact-head lease and fast-forward ancestry. Keep feat-744 in progress pending review clearance.

1. Falsify rendered Grow passage and portal language/direction tests under Arabic and LTR documents. Trace producer-selected Scripture language separately from page/questionnaire locale, English fallback and missing metadata.
2. Carry nullable passage language through the existing producer/GraphQL projection without another request or migration; regenerate SDL/introspection through repository scripts. Apply the language/direction only to passage text/reference boundaries; English labels/resources stay English.
3. Set English language/direction on confirmed English audience portal content: Story, Finder including pending/error shell, and prayer dialogs. Audit siblings and retain localized nested controls and localized content boundaries.
4. Run rendered and real-browser language, labeling, focus/keyboard/close checks, Grow geometry, repeated genuine-Auth publication E2E, broad Web and relevant producer/schema checks, strict lint/types/format and production builds. Preserve R1/R2/#2782 behavior and retained performance corpora; compare matched controlled production home/video distributions and initial request/chunk/write sets with the exact parent.
5. Record results and limitations in feat-744 and the validation report, commit conventionally with hooks, verify the remote exact head, lease-protected push, verify PR/fresh CI and clean trees. No production/config/flag/publication/import/deploy actions.
