# PR #2783 round 10: committed lesson scroll lifecycle

Exact parent/push lease: `eca4dfbaac240b7054be402a92265a66fcda04e2`. Scope is the stale delayed lesson scroll in `WatchGrowCourse.tsx`; preserve all earlier accessibility, localization, optional-loading and return-performance repairs. No live publication/import, deployment, external configuration, telemetry or production mutation.

1. Reproduce stale scrolling deterministically with fake timers and real rendered component state. Test close, replacement, repeated opens, unmount, navigation and focus departure; retain a positive active-lesson scroll control.
2. Tie scroll work to the committed active lesson with cleanup, identity and current-focus protection. Preserve intended pointer/touch behavior and direct-return initialization.
3. Reproduce trusted-keyboard focus visibility on exact-parent and repaired production builds, repeatedly at phone/desktop and English/Arabic widths, alongside prior geometry/focus/radios/tabs/localization/chunk-fault/publication contracts. Fence all telemetry.
4. Run exact full Web CI, repeated focused tests, strict lint/types/format, production builds and generated schema/introspection zero drift. Measure supported-return and ordinary-entry timing/resource distributions, retain all prior corpora and investigate budget misses.
5. Complete feat-744 after validation; compound lifecycle findings in a report. Review exact scope, stop owned services, verify the remote again, commit conventionally and push only the named branch with the exact lease.
