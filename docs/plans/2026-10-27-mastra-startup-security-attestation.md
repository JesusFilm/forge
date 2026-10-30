# Mastra startup runtime attestation

Scope: close the Mastra runtime-verification gap without SSH or a public diagnostic
route. Related fleet ticket: `docs/roadmap/platform/feat-786-runtime-certificate-remediation.md`.

The final image NODE_OPTIONS adds a Node preload while preserving the official entrypoint
and dashboard start command. Before the application imports, the serving Node
process verifies the patched Node 24 release floor, the backported Brotli decoder
marker and a benign roundtrip, then verifies public TLS controls through Node and
three independent OpenSSL stores. A certificate failure must be explicit; a
network failure never counts as a successful rejection. All probes are bounded.
Unexpected system Brotli packages require review instead of receiving a false
clean result. No exploit input, provider jobs, database writes or secrets enter
this inspection.

Only a structured version/hash/identity/result record reaches stdout. On failure,
startup exits before the application. This intentionally makes startup dependent
on the three fixed public TLS control hosts; an outage produces failed readiness,
not a security pass. All probes run in parallel with twelve-second deadlines.
The preload is removed from inherited NODE_OPTIONS before application code so
later child processes do not repeat the checks.

Railway replaces ENTRYPOINT under a dashboard start command, so the preload must
be in the image environment. Actual-image CI must exercise that override and the real Mastra command, prove that evidence and the
application share a PID, and prove disabled TLS blocks the application. Preserve
the existing isolated PostgreSQL/DuckDB acceptance, public installed-client trust
checks, storage, private networking, command, migrations and flags. Merge only
after required checks; read the exact normally released deployment/replica's
startup record and successful health status through Railway's API. Build evidence
alone does not close production. Keep the fleet ticket in progress for other rows.
