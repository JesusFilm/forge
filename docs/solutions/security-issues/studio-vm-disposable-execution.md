---
module: Studio rendering
problem_type: security_issue
tags: [studio, render, vm, cgroup, docker, leases, reconciliation]
---

# Disposable VM rendering with canonical outbound leases

The nested renderer could start inside the earlier OCI image but could not create its child-private proc while preserving outer proc masks. Repeated local unmasked namespace tests could not establish that deployment boundary. The selected dedicated VM architecture uses Docker to apply the private PID/mount/network namespaces and masks before generated code starts; it does not relax masks or expose host/supervisor proc.

The trusted host supervisor has runtime authority. Generated code runs nonroot in a disposable no-network container, and a second container independently decodes only the admitted bounded MP4. Both phases inherit one pinned cgroup and original monotonic deadline. Container client death is not container death: a separate native systemd watchdog retains the absolute deadline, and restart reconciles exact issued identities before any new claim. Expired watchdog startup must maintain continuous frozen ownership until trusted retirement, including after its own restart.

Admin remains the job authority. Migration0093 adds immutable pool/worker/dispatch assignment fields to existing leases. Persist the dispatch and its parent directory before network. Claim replay may resume eligibility but cannot grant another Docker create/start: durable operation intents are consumed once. Different boot IDs quarantine old monotonic times; malformed/torn journals are preserved. Pool-scoped authentication and exact signed lease capabilities keep global producer/claim authority off the VM.

Cancellation/reassignment can race downloads, uploads and final recording. Current eligibility is checked at canonical seams; late registered assets keep exact issued-lease edges. Persist the signed terminal record before finish; an ambiguous accepted response is recovered by exact receipt without re-render or asset duplication. Physical retirement precedes API recovery. Typed unconfirmed errors distinguish recoverable recording uncertainty from invariant violations; matching message text must never choose restart.

Deployment supply, installation, drain/update/rollback and disabled production configuration are specified in `apps/studio-render/ops/README.md`. Exact local evidence, first-failure qualifications and remaining external gates are in `docs/validation/studio-460/vm-execution/README.md`. The owned API fixture uses local Admin storage and no provider. It is not production durable-storage, HTTPS edge transport, Mux or public-release acceptance. Feat-460 stays in progress until its remaining acceptance is complete.
