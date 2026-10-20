---
title: "Use reviewed page shapes when recovering interrupted comparisons"
type: fix
status: active
date: 2026-10-15
---

The first v6 recovery acknowledged its original call and loaded cached profiles,
then stopped before reservation or model dispatch. `runEdgeBatch` still required
two sources, page zero and four candidates each from the older v4 incident.
Admin and the manual runner already admit seven reviewed v6 incidents with
different source counts, page indexes and rank bounds.

Extend the existing producer recovery manifest with the exact reviewed page
index and starting rank. Validate the executor against the same manifest,
retaining the manual command's source/end-rank interface. Preserve v4's original
prompt representation; v6 uses the existing lossless prompt representation that
its ordinary calls use. Never shrink a recovery page or relax Admin's independent
checks of candidate identities, historical context and original unknown usage.

Verify all seven v6 page shapes reach exactly one fake model call and retain
their candidates and known receipt. Reject altered generation, source, page,
rank and replacement identities before reservation. Retain the v4 prompt test,
run relevant executor/manual/client suites, typecheck, lint and format, review,
then merge through the normal PR flow. Resume the acknowledged but unreserved
replacement under a fresh execution attempt; original unknown usage stays null.
Keep unrelated sources running while this local producer fix is prepared.
