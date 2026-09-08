#!/usr/bin/env bash
# Disposable GitHub Ubuntu test host only. Match the reviewed image's Bubblewrap;
# retain the distribution AppArmor policy and run the tests as the normal user.
set -euo pipefail
if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_OS:-} != Linux || $(uname -m) != x86_64 ]]; then
  echo 'This installer is for disposable GitHub Linux x86_64 runners only.' >&2
  exit 1
fi
sudo apt-get update
sudo apt-get install -y --no-install-recommends bubblewrap build-essential meson ninja-build pkg-config libcap-dev libseccomp-dev curl xz-utils python3
studio_build=$(mktemp -d "${RUNNER_TEMP:?}/studio-native-test.XXXXXX")
trap 'rm -rf "$studio_build"' EXIT
curl --fail --location --proto '=https' --proto-redir '=https' --max-time 120 \
  https://github.com/containers/bubblewrap/releases/download/v0.11.1/bubblewrap-0.11.1.tar.xz \
  -o "$studio_build/bwrap.tar.xz"
printf '%s  %s\n' c1b7455a1283b1295879a46d5f001dfd088c0bb0f238abb5e128b3583a246f71 "$studio_build/bwrap.tar.xz" | sha256sum -c -
tar -xJf "$studio_build/bwrap.tar.xz" -C "$studio_build"
meson setup "$studio_build/build" "$studio_build/bubblewrap-0.11.1" --prefix=/usr \
  -Dman=disabled -Dtests=false -Dselinux=disabled -Dbash_completion=disabled -Dzsh_completion=disabled
ninja -C "$studio_build/build" -j 2
sudo install -o root -g root -m 0755 "$studio_build/build/bwrap" /usr/bin/bwrap
node apps/studio-render/scripts/check-native-test-prerequisites.mjs
