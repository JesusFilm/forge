# Confined Studio native CI profile

Fixed base `009cad4283515fb823568473f6a1ee6026aae9a1`. Root authorized source-only correction after hosted run34283722315/job102254581295 reached pinned Bubblewrap but failed private loopback setup with RTM_NEWADDR EPERM.

1. Preserve actual failure, inspect exact upstream setup ordering and official Noble packages, distinguish local kernel/profile evidence from hosted inference.
2. Add only the renamed upstream AppArmor v4.1.0 ABI4.0 launcher/denying-child profile to disposable renderer CI. Keep its capability transition and permissions; omit optional site-local extensions. No blanket sysctl/security disable, no root tests, no sandbox option changes.
3. Qualify actual fixed payload/alternate exec labels, zero normal capabilities, private PID/network and escape denial. A separate fixed private-namespace negative probe requests a setup capability but must still receive EPERM on a size4096 tmpfs mount at a newly created private path. Check root binary/parent ownership and non-writability; retain bounded failure audit.
4. Validate with exact Noble parser without loading any local policy, targeted actual probes using the existing local profile, affected package tests, independent Standards and Spec capability-transition reviews, and normal hooks.

No local profile load, VM, external dispatch, provider or production operations. Root owns the next hosted installation/run; neither syntax validation nor the existing local profile constitutes successful hosted candidate qualification.
