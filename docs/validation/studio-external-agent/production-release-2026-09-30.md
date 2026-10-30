# External-agent Shorts production release record

Operator evidence for feat-548. Source release and runtime deployment are
verified separately from the remaining actual-client and human-review gates.
Times below are UTC on September 30, 2026.

## Authorization and source release

The owner requested production release through the normal PR-to-main flow.
This authorized the reviewed release sequence, not a bypass of qualification,
paid-provider authorization or production authority boundaries. Local worktree
code was not a substitute for the normal source release.

[PR #2405](https://github.com/JesusFilm/forge/pull/2405) merged at 11:14:15 to
main commit `2cada6316`. The reported final check summary was 100 passing and
three skipped checks. Skips are not counted as passing qualification.

Integration preserved main's Watch exposure narrow index and migrated the four
unpublished Shorts migrations to `0122` retention, `0123` delegated narration,
`0124` immutable preparation and `0125` inspection. Their SQL bytes were
unchanged. Fresh isolated database replay passed, followed by ten focused
integration tests. Prisma generation and scoped typechecks passed. See
[integration evidence](integration-refresh-2026-09-30.md). No new Pothos fields
were introduced by this workflow.

## Database and service preparation

The coordinating release operator reported a full Admin provider-volume backup
snapshot `a77b0cb6-21b3-4ee3-a760-002f126859d8`, created at 10:58:26. This is
backup creation evidence, not a restore drill. Production's existing `0121`
migration ledger was verified before the Shorts migration rollout; the fresh
replay alone would not establish that populated-database prerequisite.

Supervisor recovery preserved the existing assignment journal. Recovery must
not be described as a fresh assignment, reset lease, or deleted uncertain work.
The recovered previous release was active and idle with zero restarts before
selection; the new release's post-activation state is recorded below. The
historical root cause was not established by this recovery.

Production uses the outbound VM render pool. Its gateway prepares immutable
draft inputs, retains independently verified output and finishes canonical
attempts. Missing direct-render URL/private-key settings are therefore not a
pool-routing defect. Existing Shorts production, render-pool and Mux controls
remain independent; publication authority is not exposed to external agents.

## Hosted renderer publication and acquisition

[Studio release workflow 36707318229](https://github.com/JesusFilm/forge/actions/runs/36707318229)
succeeded on attempt 1 from main commit `2cada63166aabfa2d9214009c6515a4c7576e880`.
The coordinating operator verified the candidate against the GitHub log SHA256
and published OCI release record before acquisition.

| Artifact                 | Immutable identity                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Candidate JSON SHA256    | `5d2a38eb8cadf45d51a770dbd88146374e2ad7bd3d06dd0a2c5a47e4ec4b04d1`                                                |
| Published release        | `ghcr.io/jesusfilm/forge-studio-releases@sha256:ee415e4f95bbca2ac0bf20fa09e05ce82fb1961e8ad2920fab65d8805f207fc0` |
| Render image             | `ghcr.io/jesusfilm/forge-studio-render@sha256:b1d880159ddc6fd1ccced06d11313e57570b532cd4e8235cefe9ca23f21ec337`   |
| Verifier image           | `ghcr.io/jesusfilm/forge-studio-verify@sha256:d0cab068de32a3e2c7dc029c760a06b6d5ee616ae9b568c552287ccd3a5afc1a`   |
| Host artifact            | `ghcr.io/jesusfilm/forge-studio-host@sha256:06c6a5d16fb2504079aad768c807002513d644194311261bb51cb9cda382bac6`     |
| Supervisor bundle SHA256 | `1aa2bc181db53a6531d092ea76db1fd052f56749c89f95df8b73a35e503ac80d`                                                |
| Retained codec           | `ghcr.io/jesusfilm/forge-studio-codec@sha256:a60de84e61cded686c703768809e34dc20bc0e501273fe1a5d4b9af5400f9cad`    |

The candidate targets `forge-render-proxmox-1`, `linux/amd64`, with profile
`studio-render-1/900s-2cpu-2g-128p-96child-128m`. Its supervisor bundle is
124,938,240 bytes and has the same SHA256 as the previously selected
bundle. The source comparison from `77eb63f` to `2cada6316` for
`apps/studio-render/src/vm`, `apps/studio-render/ops` and
`apps/studio-render/native` was empty. Existing controller evidence therefore
applies to unchanged source; this does not turn the new container fixture into
a new full controller-containment probe.

Release operator tools were absent under `/usr/local/lib/forge-studio-release/ops`.
The operator installed the exact merged-main archive, SHA256
`2e99f48d5fdf47881151c6faadfd9c9c8e60f65b5a56abdb8e98caa5a1027cc4`,
with root ownership according to the reviewed runbook. The verified candidate
was acquired successfully. Inactive host selection completed successfully, followed by the sealed-image
fixture and explicit `switch-supervisor.py --activate`, both successful. Ordinary Railway Admin, Auth
and Manager rollout outcomes remain separate from VM artifact publication.

The prepared private image smoke uses synthetic footage, narration and music;
it makes no paid provider calls. It requires the released immutable image
digests and unchanged native container/watchdog limits, then independently
verifies the exact rendered bytes. The private adapter runs outside the
aggregate job cgroup, so its scope is sealed-container image qualification;
it must not be reported as a new full production-controller containment probe.
The unchanged production controller's prior evidence is a separate record.

## Dedicated ChatGPT client and remaining onboarding

The original `jfp_shorts_mcp_production` client retains Manager's callback.
[PR #2524](https://github.com/JesusFilm/forge/pull/2524) adds a separate
`jfp_shorts_mcp_chatgpt` public web client through the normal Auth startup seed,
with the exact callback `https://chatgpt.com/connector_platform_oauth_redirect`,
required PKCE and normal consent. Its only scopes are `offline_access`,
`shorts:read`, `shorts:edit`, `shorts:render` and `shorts:narration`.
The shared resource ceiling remains unchanged. No user grants or Operator
memberships are created, and anonymous DCR retains its native-loopback policy.
This avoids the previously proposed manual authenticated registration step.

The follow-up passed 619 Auth unit tests and ten installed-provider integration
tests on a fresh isolated database, including idempotence, normal consent and
redirect/PKCE/scope/resource denials. Another 106 opt-in database tests were
skipped in the unit run, not counted as passing. Prisma generation, typecheck,
lint, formatting and independent review passed. PR #2524 merged at 11:54:53 UTC
as `8890beaf1`. Its main CI run `36711462872` passed all 14 applicable jobs,
including Auth/Manager builds, tests and Auth PostgreSQL integration; eight
unrelated or inapplicable jobs were skipped. Auth deployment
`c0610f9a-8917-4e61-8680-d417ec53a531` succeeded on this exact commit. Read-only
post-start verification confirmed health 200, the exact callback and five scopes,
public/PKCE/none authentication, required consent, one production resource and
zero user grants.

Configure ChatGPT with the production MCP URL and public
client ID, leave the client secret empty, and complete personal login/consent.
A human needs no separate Auth AppGrant to reach consent; Manager still requires
current Operator membership for tools. If a client allowlist is configured,
it must contain this client. Portable-skill loading and the actual conversation
and human review remain separate qualification gates.

## Qualification gates still open

- Actual ChatGPT consent, exchange and the complete conversation workflow are
  not established. The earlier isolated browser run encountered
  `ERR_BLOCKED_BY_CLIENT`; production-client qualification still needs personal
  login and consent. See [ChatGPT evidence](chatgpt-review-2026-09-30.md).
- Native ChatGPT skill installation passed, as recorded below. Invocation in an
  authenticated production conversation remains unverified.
- Actual Codex completed creation/render/inspection/revision with the recorded
  fixture and modality limits. See [actual client replay](final-skill-replay.md)
  and [client proof](client-proof.json). Its synthetic bearer is not production
  OAuth evidence; receiving JPEG blocks is not proof of visual judgment, and
  tone-only narration is not natural-speech quality evidence. Authenticated
  operator correction and exact-render approval remain open.
- Claude qualification remains deferred to the owner's designer, as agreed.
- Sealed-image qualification, supervisor activation and post-activation health
  passed. Full production controller containment was not reprobed by this
  container-only fixture.
- Real paid narration/provider smoke requires its own explicit authorization.
  Synthetic audio does not qualify paid-provider behavior or creative quality.

The source release does not close feat-548 while these acceptance gates remain
unresolved. Do not promote skipped, unsupported or blocked observations to passes.
No credentials, temporary login handles or tunnel capability URLs belong in this
record.

## Final runtime evidence

The coordinating operator reported successful fixture
`1e2ca313688a42008a42ea53c976b580`, completing in 109,550 ms. The exact output
was 11,494,825 bytes, SHA256
`a3c36ebb9d9493ead001cdc01016c48061a5dcc5e1a2c30e510b80a85f132478`.
Independent verification returned `decoded:true`, H.264 at 1080×1920, 30 fps,
300 frames and 10,000 ms; AAC at 48,000 Hz, stereo, 10,048 ms.

The 110 resource samples recorded peak memory of 1,366,040,576 bytes and 87
processes. Effective limits remained two CPUs, 2 GiB, zero swap and 128 aggregate
tasks, with no OOM or PID-limit events. Retirement completed and no fixture
containers remained. These measurements qualify the sealed images with the
scope limitation above; they do not claim a new aggregate-controller probe.

The reviewed switcher activation succeeded. Admin runs descendant `99554c8b` and Auth
runs the descendant `8890beaf1`; both returned HTTP 200 health responses.
Production migrations `0122` through `0125` finished with none rolled back.
The original Manager CI run was cancelled after newer main activity; normal run
`36707296030` was rerun and passed with 91 successful and three skipped jobs. That original Manager build
then failed before compilation after repeated Railway snapshot-fetch errors.
The follow-up main commit's Manager deployment
`e5d42216-2a67-4cf5-a74d-2164d434ad0a` succeeded on `8890beaf1`. Public resource
discovery now includes `offline_access`, render and narration scopes.
Post-start checks passed: public health 200, executable FFmpeg/FFprobe 7.1.5
with unchanged verified hashes, and a Manager signing public-key fingerprint
matching current Admin. Signed canonical `pending` and `mux-pending` reads
returned 200 with empty queues. The public skill ZIP returned 200 with 29,009
bytes and the exact approved SHA256 recorded below.

Post-activation VM observation confirmed the supervisor active/running with
`NRestarts=0`, `ExecMainStatus=0` and idle application status. Worker configuration
is enabled and references exactly the new render and verifier digests in the
artifact table. No release-pending marker, drain marker or running job container
remained. This is post-activation health evidence, not an actual external-client
production draft or paid-provider smoke.

## Native skill installation and connection handoff

The approved portable archive (SHA256
`bddc6f5a79a92dfa72ff70b34f4605dfb840d7c9658152772598de065677309e`)
was uploaded through ChatGPT's native Skills → Add skill → Upload from your
computer flow. The UI reported “Skill uploaded” and listed “Shorts creator” as
Installed. The editor showed all nine packaged files: `SKILL.md`,
`agents/openai.yaml`, five examples and two references; ChatGPT also displayed
an icon asset. Visible instructions and the connection reference matched the
supplied skill. This establishes native installation and visible file presence,
not actual conversation invocation or a byte-level readback of every file.

The production MCP connection form was prepared in the signed-in ChatGPT account
with the exact public client, resource and five scopes. OIDC identity scopes,
DCR and the hosted chat/instructions scopes were excluded. Automatic approval
review rejected the Create action pending specific user approval for persistent
production access. No production connector creation, OAuth consent or user grant
is claimed. Personal Jesus Film login and consent, actual conversation use and
human exact-render correction/approval remain outstanding. The user was asked
for the required connection approval while unaffected release work continued.
