# Renderer CI AppArmor qualification

2026-09-09; fixed base `009cad4283515fb823568473f6a1ee6026aae9a1`.

## Diagnosis

Run34283722315/job102254581295 built and installed pinned Bubblewrap 0.11.1, then failed preflight with `loopback: Failed RTM_NEWADDR: Operation not permitted`. Original log is preserved as hosted-red.log. This is a later failure than the first CI missing-binary result.

Official archive packages inspected read-only: Noble `apparmor_4.0.1really4.0.1-0ubuntu0.24.04.7_amd64.deb` SHA256 `45c30f4a9724a21e2f5f91a0556f979c13ab2042e6a38c7fdd6da87829e8d67e` and the exact installed `bubblewrap_0.9.0-1ubuntu0.1_amd64.deb` SHA256 `1b506492bd9c7fd0cdb4f02ac822f1d3e336b0aead5113c1239baf8db5db562a`. Neither ships a bwrap AppArmor profile. The former's generic unprivileged_userns profile audit-denies capabilities. The latter's sysctl file enables the generic Debian userns-clone primitive; it does not supply an AppArmor exception. The corrected installer no longer installs this unnecessary distro Bubblewrap package.

[Bubblewrap v0.11.1](https://github.com/containers/bubblewrap/blob/v0.11.1/bubblewrap.c) configures loopback after namespace creation and before payload capability dropping. [Its network setup](https://github.com/containers/bubblewrap/blob/v0.11.1/network.c) sends RTM_NEWADDR. A test-only preload denying that one netlink request reproduces the exact error; this confirms the failure location, **not the runner's exact loaded policy**. Local Ubuntu26/7.0 has a bwrap profile and succeeds with identical options. Forcing its generic restricted profile fails earlier and is retained as a different-kernel result. The original hosted audit/profile inventory was unavailable; AppArmor capability denial is the supported hypothesis, not an observed kernel audit finding.

## CI-only correction

Use [AppArmor upstream v4.1.0's ABI4.0 profile](https://gitlab.com/apparmor/apparmor/-/raw/v4.1.0/profiles/apparmor/profiles/extras/bwrap-userns-restrict), upstream SHA256 `634d3d3427c483f123cb5ed53b71ea13040187e07d9f67ca74421d42a6170f0e`. Exact adaptations: rename bwrap/unpriv_bwrap to forge_studio_ci_bwrap/forge_studio_ci_child, omit optional site-local includes, add provenance comments. No permission expansion. Launcher attachment is exclusively `/usr/bin/bwrap`; every executable path transitions through the upstream stacked denying child profile. The normal payload has no effective/permitted/ambient capabilities. The explicit negative probe alone requests CAP_SYS_ADMIN inside its own user/mount/network namespace and verifies that the child profile denies its private mount despite the visible capability bit.

The installer writes only its dedicated profile on a disposable GitHub runner, loads it without disabling another profile, and records loaded labels/ownership. A profile collision or unexpected transition fails closed. The preflight checks actual enforced stacked child labels (including direct Python and `/usr/bin/env` exec), private PID1 and a different loopback-only network namespace, zero normal payload capabilities, and denied namespace escape. It checks root ownership, absence of setuid/group/other write and actual runner non-writability for the executable and all parent directories. Tests cannot run as root. The fixture's `/probe` is created inside the private root, never host-bound; at most a size4096 tmpfs can be mounted there if the negative test fails, and namespace teardown discards it. Production launcher flags/code are untouched.

A failure retains bounded kernel AppArmor audit output. No global sysctl or AppArmor disable is used. No fallback profile or test skip is introduced.

## Evidence and limits

- Exact extracted Noble apparmor_parser4.0.1 accepts final profile with `-Q -T` and Noble ABI/includes; no kernel policy loaded.
- Actual local normal payload: PID1, private lo-only network, zero capabilities, denying enforced profile on direct and alternate execs, escape denied. Actual separate fixed negative probe: CAP_SYS_ADMIN bit present, mount EPERM under existing bwrap//&unpriv_bwrap(enforce).
- The attempted unconfined control (`unconfined-control-red.log`) was **not an unconfined/red control**: actual output still shows the existing denying profile and succeeds. Filename/initial harness label are historical, not an acceptance claim.
- No dedicated CI profile was loaded locally. These local records validate fixture behavior under the existing local policy, not the new candidate under the hosted kernel.
- Failure-first validator tests, actual data/escape tests and affected renderer suite recorded. Existing artifact-dependent skips are unchanged.

Actual hosted attachment, audit, installer and security suite remain the next CI acceptance gate. Root reported the previous CodeQL alerts already clear; this phase changes no preview code. No VM/image/provider/production work or workflow dispatch occurred.
