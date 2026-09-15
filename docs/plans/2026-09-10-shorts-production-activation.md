# Activate Shorts rendering

Continue feat-462 under the owner’s explicit deployment instruction. Enable manual hosted release, publish immutable images and supervisor bundle, install on the dedicated Proxmox VM, provision scoped production keys, enable the worker and direct Mux upload, and verify one bounded Short. Preserve normal PR-to-main deployment and do not give credentials or network access to authored containers. Do not activate public publication as part of rendering. Keep rollback artifacts and record final deployment identities without committing logs or secrets.

The first hosted release rejected GitHub’s current `ghs_APPID_JWT` token before login because the validator excluded dots and hyphens. Accept bounded header-safe token bytes without interpreting JWT contents; retain rejection of whitespace, quotes, backslashes and oversized values. A local regression reproduces the rejection and verifies password-stdin transport.
