# Final-suite environment qualification

The first full Admin run passed 6,170 tests and failed two unchanged environment-dependent cases. Its explicit owned PostgreSQL URL did not match env.test.ts's placeholder expectation. rate-limit.test.ts expected Redis connection failure at localhost:6379 but received source=redis. The loopback-only guard did not deny that non-owned port; one expiring test rate-limit counter may have been incremented. No shared key inspection, cleanup or service stop was performed. This uncertainty is preserved rather than presenting the run as green.

The stricter task-local network guard admits only named 460 ports and listeners created by the same process for their active lifetime. It denies other loopback destinations, external TCP and unowned Unix paths. The independent verification proves default6379/5432/unrelated80/external/unownedUnix rejection and owned-listener admission/removal. Both failed files pass 72 tests under the corrected placeholder setup and guard. The full Admin rerun uses that verified guard too; no application Redis behavior changed.

A final-build browser launch failed before any page navigation because /tmp ran out of inodes: Chrome could not create shared-memory/cache files and reported ENOSPC. The owned disk TMPDIR rerun proceeded normally. No sibling cleanup occurred; this is not a browser-product failure.

The strict full rerun passed all 6,172 tests but recorded one blocked dd-trace background TCP request as an unhandled error. It is not a clean suite result. The verified guard now also denies UDP, and test-only Datadog tracing/telemetry/remote-configuration/runtime-metrics flags are disabled. The affected instrumentation plus environment/rate-limit files pass 83 tests under that configuration. No application telemetry code or endpoint allowlist was weakened.

Final full run:402 files / 6,172 tests pass,29 explicitly database-gated files / 164 skips and 1 todo, with no unhandled errors under the verified strict guard and disabled test telemetry. The earlier loopback-only run does not establish that non-owned local services were untouched; the observed Redis outcome and subsequent denied telemetry are disclosed above.

The precommit check found explicit-any annotations in the retained receiver harness. Replacing those erased annotations produces byte-identical emitted JavaScript with esbuild identifier minification disabled; equivalence evidence is retained. This is a typing/formatting adaptation, not a repeated native chain execution or a changed result.
