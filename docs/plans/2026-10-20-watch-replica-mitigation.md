# Watch replica mitigation

## Scope and decision

Investigate the Watch owner's latency report and `ds-emergency` alerts, apply
the authorized second production Web replica, and preserve that setting through
the normal PR-to-main deployment flow. Track this delivery in feat-748;
feat-746 records diagnosis and feat-747 retains the separate serialization work.

The live profiles show CPU contention on the JavaScript request thread despite
unused service CPU allowance. Adding an independent request process is the
smallest reversible mitigation supported by that evidence. Keep both replicas
in the existing `us-west2` region and retain the shared Redis cache, healthcheck,
Datadog preload and resource limits.

## Work and verification

1. Record the pre-change timing loop, active deployment and replica count.
2. Apply one configuration change: `us-west2.numReplicas` from one to two.
3. Require Railway to report two running replicas with zero crashes and no
   pending rollout. Confirm the active deployment ID is unchanged.
4. Repeat bounded public GET probes for home, video and language pages. Compare
   origin page durations using the same successful-GET filter, documenting
   sample sizes and the unmatched traffic populations.
5. Add only the production environment's replica configuration to
   `apps/web/railway.toml`. Validate TOML against Railway's current JSON schema,
   check formatting and inspect the complete PR diff.
6. Record evidence and limits in the incident report. Keep the separate
   serialization repair open rather than claiming that scaling fixes its cause.

## Delivery and limits

Do not deploy a local build, trigger a redeploy, flush caches or alter feature
flags. The production scale change uses the running release; the repository
configuration goes through a PR. No frontend code changes, so a frontend rebuild
or visual smoke test does not validate this configuration-only change.

This increases running capacity and cost. Reconsider the second replica only
after feat-747 demonstrates adequate headroom under representative mixed traffic.
To reverse the mitigation, remove the production override through PR and change
the live region's replica count to one with authorization, then repeat the same
measurements. Removing the file override alone does not reset dashboard state.

Railway currently supports this existing Config-as-Code service but documents a
December 1, 2026 cutoff. Migrate the repository's deployment configuration before
that date as separate infrastructure work; do not combine a project migration
with this incident repair.
