# Studio PR 2205 native test prerequisites

Fixed base: `56258cff495248f8f94e1a57ba5d34643f61af3a`.

Root approved a bounded fix for run 34281960816/job 102248972948: diagnose the six pre-readiness renderer failures; install pinned native prerequisites in only the renderer test matrix; fail closed with useful diagnostics. Preserve every security assertion and production sandbox. Root separately added CodeQL annotation 102248731414 at preview server.test.ts:43 to remove generated-code data interpolation.

## Execution

1. Run the eight affected native tests at the exact base; reproduce the missing launcher failure in a task-owned copied fixture.
2. Add failure-first prerequisite admission tests and the renderer-only installer using the Dockerfile's existing Bubblewrap 0.11.1 archive checksum. Preserve distribution AppArmor policy; no sysctl, privileged test execution or security skips.
3. Pass the preview clock path as child environment data to static preload code. Preserve the real native HTTP expiry/range tests.
4. Run affected renderer package tests, preview server tests, workflow/shell validation; independently review Standards and Spec against the fixed base; commit with normal hooks.

No CI dispatch, push, VM, image build, provider or production operation. Hosted installation and CodeQL rerun remain CI verification, not claimed local evidence.
