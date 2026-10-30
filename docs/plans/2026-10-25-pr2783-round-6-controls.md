# PR #2783 round 6: accessible audience controls

Exact parent: `d754d983e28ca4eede40e98bbc099a07ce8e600f`.

Repair the full Grow course mode radio group and Admin audience editor tabs.
Audit adjacent audience radios/tabs and repair the same confirmed defects in
Finder duration, Grow reading-plan filters and Partner resource filters.
Preserve authored language boundaries, role-menu behavior, persistence,
publication, learning concurrency and the default-off feature flag.

Use native radio interaction, including native Space/arrows and one group Tab
stop. These controls have English/LTR chrome even on Arabic pages. Do not add
Home/End behavior to native radios. Use automatic activation for synchronous
local tabs, roving focus, arrow wrapping and Home/End. Admin currently supports
English/Spanish; its English audience role tablist explicitly owns LTR direction.
Do not force authored question/input content to English.

Reproduce both findings before fixes with component assertions; exercise actual
native keyboard behavior and visible focus in Chromium, including phone and
Arabic contexts. Test editor controlled rerenders, invalid draft retention and
published/draft isolation independently. The isolated Admin component browser
fixture must use the real production component and built Admin CSS, not mocked
tab handlers. Publication and hosted-Auth Partner coverage retain real services.

Run cold focused repeats, CI Web/Admin test commands, strict types/lint/format,
production builds, SDL/introspection zero drift and default-off guards. Compare
production parent/candidate loading with interleaved repeated samples and local
media, plus actual course mount and editor interaction windows. Fence all browser
and server telemetry; retain requests, distributions and initial deferred-chunk,
prefetch and write assertions. No external-media corpus or production actions.

Restore feat-744 complete only after repaired scope passes; record accurate
results and limits. Commit with hooks, verify the exact remote parent again and
push only the audience editor branch with the pinned lease. Stop owned services.
