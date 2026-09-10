> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Decision needed: where safe Studio exports run

The editor and publication work can be retained. The remaining export problem is that the intended container prevents creating the extra private process filesystem required by the current renderer. More repetitions of the same test cannot establish a missing platform capability. No support request or infrastructure change has been made.

## Option A — keep the existing Railway execution service

This needs a verified platform bootstrap that creates the job's private process filesystem **before** the platform locks its process masks, then applies every approved mask/read-only control before authored code starts. An ordinary entrypoint is too late. Railway pre-deploy runs in a separate container and is not this hook. Public documentation reviewed so far does not establish support; that is uncertainty, not proof Railway cannot support it.

If supported, the smallest implementation would change trusted namespace startup and explicitly replay/verify the complete masks. Broker APIs, immutable input/output identity, the900-second cumulative deadline and resource budgets stay. Local tests can prove a proposed ordering on an OCI runner, but cannot prove Railway supplies it. The next external step would be an explicitly authorized capability question, followed by review of exact supported configuration before any deployment. No broad host capability or exposed supervisor process filesystem is an acceptable shortcut.

## Option B — one disposable execution container per job

Move container lifecycle supervision outside the execution container. The runtime creates the single job container's private process filesystem and masks in normal OCI order. The render process uses that already-private filesystem, avoiding the nested fresh-proc creation that currently fails. There is no credential-bearing API supervisor inside the authored-code container.

Keep the existing trusted broker, immutable manifest/hash checks, durable job lease/fencing, cancellation and retained-result rules. Replace its long-lived private execution HTTP dispatch with a trusted local/runtime adapter that creates one credential-free job container, stages only the exact bounded inputs and reads bounded output after exit. The runtime socket and credentials stay outside. No arbitrary mounts or network enter the job.

The adapter must enforce the existing900-second cumulative staging/render/verification/delivery budget with an independent watchdog, kill and confirm the whole job cgroup on timeout/cancel/OOM, and preserve1-second cleanup/2-second retirement allowances. Keep2CPU,2GiB,no swap,128aggregate tasks,96child limit and128MiB input/output, with one job concurrency. Keep the1200-second durable lease and90-second preparation/60-second retention bounds. Independent codec verification can run in a separate credential-free verifier container under the **same remaining deadline**, never a fresh900 seconds; its cgroup/outputs must also be bounded and verified. Mux readiness and publication remain separate trusted phases.

This option requires reviewed code changes to the execution entrypoint/launcher and broker transport, plus an OCI-capable runtime able to create/inspect/kill disposable containers with enforced cgroups. A container cannot safely acquire that authority merely by receiving a host runtime socket. The intended Railway platform's job-container lifecycle API/support has not been established; a dedicated approved runner may be necessary. It is an architecture/infrastructure decision, not a deploy-ready patch.

Local authorized implementation could establish exact-image render/decode, process/mount isolation, all bounds, cancellation/OOM/restart, output transfer/fencing and deadline behavior. It would not establish intended-platform operation, private connectivity, durable artifact supply or actual Mux acceptance. Architecture implementation, named runtime provisioning/deployment and provider validation each need their own scope/authorization; none are performed by this brief.

## Recommendation for the next decision

Choose whether to ask the intended platform to establish Option A's exact bootstrap capability, or authorize design/implementation of Option B against a named OCI-capable runtime. Option B avoids the demonstrated nested-proc dependency but introduces external container lifecycle operations. Keeping exports disabled is only the interim safety state, not completion. Both paths must ultimately produce a functioning contained export; neither removes the existing Watch/revocation or provider acceptance requirements.
